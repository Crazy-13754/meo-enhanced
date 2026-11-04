import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launchTestBrowser } from './browser-test-helpers';
import runtime from '../src/export/runtime';
import { decodeBlockExportResponse } from '../src/protocol/blockExport';
import type { ReadingSnapshot } from '../src/protocol/exportSnapshot';
import { preparePdfPagination, materializeDocxBodyFromHtmlExport } from '../src/export/pdfRenderer';

const extras = process.env.MEO_EXTRAS_DIR;
if (!extras) throw new Error('Set MEO_EXTRAS_DIR to the built MEO Extras directory.');
const out = path.resolve('.local/block-export-tests'); mkdirSync(out, { recursive: true });
const build = await Bun.build({ entrypoints: ['scripts/test-block-export-entry.ts'], target: 'browser', format: 'iife' });
assert(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const prefix = 'https://block-export.test/';
    if (!request.url().startsWith(prefix)) { void request.continue(); return; }
    const asset = request.url().slice(prefix.length);
    const fake = `export const apiVersion=1;export function createSvgRenderer(){return {render:async(s,a)=>{if(s.text.includes('broken'))throw new Error('fixture failure');return '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="'+a.background+'"/><text x="10" y="45" fill="'+a.foreground+'">Third renderer</text></svg>'},dispose(){}}}`;
    void request.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
      body: asset === 'third.js' ? fake : readFileSync(path.join(extras, 'dist', asset)) });
  });
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.exposeFunction('renderContent', (text: string) => runtime.renderDocumentContent(text));
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  await page.evaluate(() => {
    const w = window as any; let counter = 0;
    const waiters = new Map<string, (reply: any) => void>();
    w.adapter = w.createBlockExportAdapter((reply: any) => { waiters.get(reply.requestId)?.(reply); waiters.delete(reply.requestId); },
      (payload: any, signal: AbortSignal) => w.renderExportBlocks(payload, w.renderContent, signal));
    w.exportBlocks = (payload: any) => new Promise(resolve => {
      const requestId = 'browser-' + ++counter; waiters.set(requestId, resolve);
      w.adapter.accept(w.decodeHostToWebviewMessage({ type: 'requestBlockExport', requestId, payload }));
    });
    const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; style-src 'unsafe-inline'; script-src https://block-export.test 'wasm-unsafe-eval'; connect-src https://block-export.test; worker-src blob:; font-src data:; img-src data:";
    document.head.append(policy);
  });
  const markdown = '# 图块导出\n\n```markmap\n# 项目计划\n## 内容\n- **粗体** $x^2$\n\n| 名称 | 状态 |\n| --- | --- |\n| 接口 | 完成 |\n\n## 配色 <!-- nodeColor: #34d399 -->\n- 测试\n```\n\n> ```puml\n> @startuml\n> Alice -> Bob: 测试\n> @enduml\n> ```\n\n```third\nsame\n```\n\n```third\nsame\n```\n\n```third\nbroken\n```\n';
  const renderers = [
    { id: 'fixture/map', label: 'Map', codeBlockLanguages: ['markmap'], entryUri: 'https://block-export.test/view.js' },
    { id: 'fixture/uml', label: 'UML', codeBlockLanguages: ['plantuml', 'puml'], entryUri: 'https://block-export.test/plantuml/renderer.js' },
    { id: 'fixture/third', label: 'Third', codeBlockLanguages: ['third'], entryUri: 'https://block-export.test/third.js' }
  ];
  for (const appearance of ['light', 'dark'] as const) for (const target of ['html', 'pdf', 'docx'] as const) {
    if (appearance === 'dark' && target !== 'html') continue;
    const snapshot: ReadingSnapshot = { snapshotId: `${appearance}-${target}`, text: markdown, appearance, uiLanguage: 'zh-CN',
      environment: { previewFontFamily: 'system-ui', editorFontFamily: 'system-ui', editorFontSizePx: 16, previewSourceColoring: false }, blockRenderers: renderers };
    const generated = await runtime.renderExportHtmlDocument({ readingSnapshot: snapshot, sourceDocumentPath: path.join(out, 'source.md'), outputFilePath: path.join(out, 'output.' + target),
      target, title: 'Export test', mermaidRuntimeSrc: '', shikiLanguageAssetsRoot: path.resolve('webview/dist'), includeTableOfContents: true });
    const result = await runtime.materializeContributedBlocks(generated.htmlDocument, snapshot, target, async payload => {
      const raw = await page.evaluate(payload => (window as any).exportBlocks(payload), payload);
      const reply = decodeBlockExportResponse(raw); assert(reply?.result.ok, JSON.stringify(raw).slice(0, 1500));
      const items = reply.result.value;
      assert.equal(items.length, 5);
      for (const item of items.slice(0, 4)) assert('artifact' in item, JSON.stringify(item));
      if ('artifact' in items[0]!) {
        assert(items[0].artifact.data.includes('项目计划')); assert(items[0].artifact.data.includes('table')); assert(items[0].artifact.data.includes('math'));
      }
      if (appearance === 'dark' && target === 'html' && 'artifact' in items[1]!) {
        const readable = await page.evaluate(svg => [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')]
          .every(text => { const hex = text.getAttribute('fill') ?? ''; return /^#[\da-f]{6}$/i.test(hex) && parseInt(hex.slice(1, 3), 16) > 128; }), items[1].artifact.data);
        assert(readable, 'Dark PlantUML resolves CSS colors to readable RGB engine colors');
      }
      return items;
    });
    assert.equal(result.warnings.length, 1, result.warnings.join('\n'));
    assert(result.html.includes('broken')); assert(!result.html.includes('block-export.test'));
    assert.equal(await page.$$('iframe').then(frames => frames.length), 0, 'Export containers are released');
    const filename = path.join(out, `${appearance}.${target}`);
    const options = { htmlDocument: result.html, puppeteerRuntimeModulePath: path.resolve('dist/puppeteer-runtime.js') };
    if (target === 'html') {
      writeFileSync(filename, result.html);
      const outputPage = await browser.newPage(); await outputPage.setViewport({ width: 1000, height: 900 });
      await outputPage.setContent(result.html, { waitUntil: 'load' });
      await outputPage.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
      assert.equal(await outputPage.$$('.meo-export-contributed').then(nodes => nodes.length), 4);
      const sizes = await outputPage.$$eval('.meo-export-contributed img', images => images.map(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight })));
      assert(sizes.every(size => size.width > 0 && size.height > 0));
      await outputPage.screenshot({ path: path.join(out, appearance + '.png'), fullPage: true }); await outputPage.close();
    } else if (target === 'pdf') {
      await runtime.renderPdfFromHtmlExport({ ...options, outputPdfPath: filename }); assert(readFileSync(filename).subarray(0, 5).equals(Buffer.from('%PDF-')));
    } else {
      await runtime.writeDocxExport({ ...options, outputDocxPath: filename, title: 'Export test', uiLanguage: 'zh-CN', includeTableOfContents: true, docxRuntimeModulePath: path.resolve('dist/docx-runtime.js') });
      const zip = await JSZip.loadAsync(readFileSync(filename)); assert(Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name]!.dir).length >= 3);
      const xml = await zip.file('word/document.xml')!.async('string'); assert(xml.includes('broken')); assert(xml.includes('图块导出'));
    }
    console.log(`PASS: ${appearance} ${target}, real Markmap/PlantUML and registered third renderer`);
  }
  const lifecycle = await page.evaluate(async () => {
    const w = window as any;
    const payload = { blocks: [{ id: 'one', language: 'generic', text: 'immutable' }],
      renderers: [{ id: 'generic', label: 'Generic', codeBlockLanguages: ['generic'], entryUri: 'fixture' }],
      styles: 'body{background:white;color:black}', target: 'html', language: 'en', fontFamily: 'system-ui', fontSize: 16, fontWeight: '400', codeFontFamily: 'monospace' };
    let disposed = 0;
    const abort = new AbortController();
    const running = w.renderExportBlocks(payload, async () => ({ html: '' }), abort.signal, async () => ({ apiVersion: 1,
      createBlockExportRenderer() { return { render: () => new Promise(resolve => setTimeout(() => resolve({ kind: 'png', data: '', width: 1, height: 1 }), 100)), dispose() { disposed++; } }; } }));
    setTimeout(() => abort.abort(), 20);
    let cancelled = false; try { await running; } catch { cancelled = true; }
    const unsupported = await w.renderExportBlocks(payload, async () => ({ html: '' }), new AbortController().signal, async () => ({ apiVersion: 1 }));
    const unsafe = await w.renderExportBlocks(payload, async () => ({ html: '' }), new AbortController().signal, async () => ({ apiVersion: 1,
      createSvgRenderer: () => ({ render: async () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>', dispose() {} }) }));
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 10; canvas.getContext('2d')!.fillRect(0, 0, 20, 10);
    const png = await w.renderExportBlocks(payload, async () => ({ html: '' }), new AbortController().signal, async () => ({ apiVersion: 1,
      createBlockExportRenderer: () => ({ render: async () => ({ kind: 'png', data: canvas.toDataURL().split(',')[1], width: 20, height: 10 }), dispose() {} }) }));
    return { cancelled, disposed, unsupported: !!unsupported[0].error, unsafe: !!unsafe[0].error, png: png[0].artifact?.kind, frames: document.querySelectorAll('iframe').length };
  });
  assert.deepEqual(lifecycle, { cancelled: true, disposed: 1, unsupported: true, unsafe: true, png: 'png', frames: 0 });
  const large: ReadingSnapshot = { snapshotId: 'large', text: '# Large\n\n' + 'Ordinary content.\n\n'.repeat(9000) + markdown,
    appearance: 'light', uiLanguage: 'en', environment: { previewFontFamily: 'system-ui', previewSourceColoring: false }, blockRenderers: renderers };
  const largeHtml = await runtime.renderExportHtmlDocument({ readingSnapshot: large, sourceDocumentPath: path.join(out, 'large.md'), target: 'html', title: 'Large', mermaidRuntimeSrc: '', shikiLanguageAssetsRoot: path.resolve('webview/dist') });
  const largeResult = await runtime.materializeContributedBlocks(largeHtml.htmlDocument, large, 'html', async payload => {
    const raw = await page.evaluate(payload => (window as any).exportBlocks(payload), payload);
    const reply = decodeBlockExportResponse(raw); assert(reply?.result.ok); return reply.result.value;
  });
  assert.equal((largeResult.html.match(/class="meo-export-contributed /g) ?? []).length, 4);
  assert.equal(largeResult.warnings.length, 1);
  console.log('PASS: production CSP, PNG adapter, cancellation, invalid/unsupported adapters and large offscreen document');
  const tallSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="12000"><rect width="400" height="12000" fill="red"/><text y="11980">End</text></svg>').toString('base64');
  const tallImage = `<div class="meo-export-contributed"><img src="data:image/svg+xml;base64,${tallSvg}" width="400" height="12000" style="max-width:100%;height:auto"/></div>`;
  const tallHtml = '<!doctype html><html><body><main class="meo-export-doc" style="width:600px">' + tallImage + '</main><script>window.__MEO_EXPORT_READY__=true</script></body></html>';
  const layout = await browser.newPage(); await layout.setContent(tallHtml); await layout.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await preparePdfPagination(layout, 900);
  assert(await layout.$eval('img', image => image.getBoundingClientRect().height <= 892), 'Tall diagrams fit PDF page height'); await layout.close();
  const wordBody = await materializeDocxBodyFromHtmlExport({ htmlDocument: tallHtml, puppeteerRuntimeModulePath: path.resolve('dist/puppeteer-runtime.js') });
  assert(/data-meo-docx-materialized/.test(wordBody));
  console.log('PASS: oversized vector diagrams fit PDF pages and bounded Word rasterization');
  await page.evaluate(() => (window as any).adapter.dispose());
} finally { await browser.close(); }
