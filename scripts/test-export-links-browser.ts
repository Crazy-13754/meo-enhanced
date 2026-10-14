import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import exportRuntime from '../src/export/runtime';
import { encodeMarkdownPath } from '../src/foundation/linkDestination';
import { previewPresets } from '../src/foundation/previewPresets';
import { createCustomPreviewPreset, parseCustomPreviewPresetManifest } from '../src/foundation/customPreviewPreset';
import { launchTestBrowser } from './browser-test-helpers';

const root = path.resolve('tmp/export-links-browser');
await mkdir(root, { recursive: true });
const local = path.join(root, 'local target 中文.html');
const localUri = pathToFileURL(local).href;
await writeFile(local, '<!doctype html><title>Local target</title><h1 id="local-target">Local target</h1>');
const custom = createCustomPreviewPreset(parseCustomPreviewPresetManifest({
  schemaVersion: 1, id: 'export-links', name: 'Export links', description: 'Link contract', base: 'github-readme',
  themes: { light: { css: 'light.css' }, dark: { css: 'dark.css' } }
}), { light: '', dark: '' }, 'a'.repeat(64));
const text = [
  '# Export links', `[Absolute](<${encodeMarkdownPath(local.replace(/\\/g, '/'))}>)`,
  `[Encoded absolute](<${encodeMarkdownPath(local)}>)`, `[File URI](<${localUri}>)`,
  `<a href="${encodeMarkdownPath(local.replace(/\\/g, '/'))}">Raw absolute</a>`,
  `[Relative](<${encodeMarkdownPath(path.basename(local))}>)`, `[Local fragment](<${localUri}#local-target>)`,
  '[Web](https://example.com/path?q=a%20b#part%2Fid)', '[Mail](mailto:reader@example.com)',
  '[Section](#target)', '[Chinese](#中文标题)',
  '<span id="raw-id">Raw target</span> <a href="#raw-id">Raw section</a>',
  'Footnote[^note]', '## Target', '## 中文标题', '[^note]: Footnote body'
].join('\n\n');
const sameFile = (first: string, second: string) => decodeURIComponent(new URL(first).pathname) === decodeURIComponent(new URL(second).pathname);
const quotePdfString = (value: string) => value.replace(/[\\()]/g, character => `\\${character}`);
const browser = await launchTestBrowser();
try {
  for (const definition of [...previewPresets, custom]) {
    const name = definition.id.replace(':', '-');
    const htmlPath = path.join(root, `${name} 报告 %23 #1.html`);
    const pdfPath = path.join(root, `${name}.pdf`);
    const base = {
      readingSnapshot: { snapshotId: 'export-link-browser', text, appearance: 'light' as const, uiLanguage: 'en' as const, preset: definition.id,
        environment: { previewFontFamily: '', previewSourceColoring: false, previewShowComments: false } },
      presetDefinition: definition, sourceDocumentPath: path.join(root, 'source.md'),
      mermaidRuntimeSrc: '', baseHref: pathToFileURL(root + path.sep).href, title: 'Export links',
      shikiLanguageAssetsRoot: path.resolve('webview/dist'), includeTableOfContents: true
    };
    const html = await exportRuntime.renderExportHtmlDocument({ ...base, target: 'html', outputFilePath: htmlPath });
    await writeFile(htmlPath, html.htmlDocument);
    const page = await browser.newPage();
    let links: Array<{ text: string; href: string }> = [];
    try {
      const original = pathToFileURL(htmlPath).href;
      const open = async () => {
        await page.goto(original);
        await page.waitForFunction(() => (window as any).__MEO_EXPORT_READY__ === true);
      };
      await open();
      links = await page.$$eval('.meo-export-doc a', anchors => anchors.map(anchor => ({ text: anchor.textContent ?? '', href: (anchor as HTMLAnchorElement).href })));
      for (const label of ['Absolute', 'Encoded absolute', 'File URI', 'Raw absolute', 'Relative', 'Local fragment']) {
        const link = links.find(link => link.text === label);
        assert.ok(link && sameFile(link.href, localUri), `${definition.id}/${label}: exported links identify the authored file`);
        assert.equal(new URL(link.href).hash, label === 'Local fragment' ? '#local-target' : '');
      }
      // Trusted pointer clicks must remain inside this HTML file, including
      // Unicode IDs, raw HTML IDs, generated contents and both footnote directions.
      const selectors = ['a[href$="#target"]:not(.meo-export-toc-link)', 'a[href$="#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98"]:not(.meo-export-toc-link)',
        `a[href$="#${definition.renderer === 'github-readme' ? 'user-content-' : ''}raw-id"]`,
        '.meo-export-toc-link[href$="#target"]', 'a#fnref-1', '.footnote-backref'];
      for (const selector of selectors) {
        await open();
        await Promise.all([page.waitForNavigation(), page.click(selector)]);
        assert.ok(sameFile(page.url(), original), `${definition.id}/${selector}: internal links must not navigate to the resource directory`);
        const id = decodeURIComponent(new URL(page.url()).hash.slice(1));
        assert.ok(await page.evaluate(id => !!document.getElementById(id), id), `${id} must identify a real destination`);
      }
      await open();
      await Promise.all([page.waitForNavigation(), page.click(`a[href="${localUri}"]`)]);
      assert.equal(await page.title(), 'Local target');
      assert.ok(sameFile(page.url(), localUri));
    } finally { await page.close(); }
    const pdf = await exportRuntime.renderExportHtmlDocument({ ...base, target: 'pdf', outputFilePath: pdfPath });
    await exportRuntime.renderPdfFromHtmlExport({ htmlDocument: pdf.htmlDocument, outputPdfPath: pdfPath,
      puppeteerRuntimeModulePath: path.resolve('dist/puppeteer-runtime.js') });
    const bytes = (await readFile(pdfPath)).toString('latin1');
    // Chromium emits link annotations as ordinary PDF dictionaries. Inspect
    // their URI/destination actions rather than accepting a PDF header alone.
    const annotations = [...bytes.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g)]
      .map(match => match[1]).filter(object => /\/Subtype\s*\/Link\b/.test(object));
    for (const link of links.filter(link => ['Absolute', 'Encoded absolute', 'File URI', 'Raw absolute', 'Relative', 'Local fragment', 'Web', 'Mail'].includes(link.text))) {
      assert.ok(annotations.some(object => object.includes(`/URI (${quotePdfString(link.href)})`)), `${definition.id}/${link.text}: PDF must contain the same destination as HTML`);
    }
    for (const id of ['target', definition.renderer === 'github-readme' ? 'user-content-raw-id' : 'raw-id', 'fn-1', 'fnref-1']) {
      assert.ok(annotations.some(object => new RegExp(`/Dest /${id}(?:\\s|>)`).test(object)), `${definition.id}/${id}: PDF anchors must be document destinations`);
    }
    console.log(`${definition.id}: HTML pointer navigation and final PDF URI/anchor annotations passed`);
  }
} finally { await browser.close(); }
