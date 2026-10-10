import assert from 'node:assert/strict';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';

const build = await Bun.build({ entrypoints: ['scripts/test-wiki-production-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let stage = 'initial Live images';
let diagnosticPage: Awaited<ReturnType<typeof browser.newPage>> | undefined;
try {
  const page = await browser.newPage();
  diagnosticPage = page;
  await page.setViewport({ width: 1000, height: 1400 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const text = 'Start\n\n![[assets/中文 图片.png|300x200]]\n\n![[assets/中文 图片.png|180]]\n\n[[assets/中文 图片.png|图片链接]]\n\n| A | B |\n| --- | --- |\n| ![[assets/中文 图片.png\\|120]] | x |\n| [[assets/中文 图片.png\\|表格链接]] | y |\n\n`![[literal.png]]`\n\n```md\n![[code.png]]\n```\n\nEnd';
  await page.evaluate(text => {
    const harness = (window as any).WikiHarness;
    const state = (window as any).__wiki = { resolutions: [] as string[], version: 1, editor: null as any };
    harness.setImageSrcResolver((url: string) => {
      state.resolutions.push(url);
      return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${state.version === 1 ? '#468' : '#864'}"/></svg>`)}`;
    });
    state.editor = harness.createEditor({ parent: document.getElementById('app')!, text, initialMode: 'live', onApplyChanges() {} });
  }, text);
  await page.waitForFunction(() => document.querySelectorAll('.meo-md-image-img').length === 3);
  const live = await page.evaluate(() => ({
    images: [...document.querySelectorAll<HTMLImageElement>('.meo-md-image-img')].map(img => ({ width: img.style.width, height: img.style.height, natural: img.naturalWidth })),
    text: (window as any).__wiki.editor.getText(),
    links: [...document.querySelectorAll<HTMLElement>('[data-meo-link-href]')].map(link => link.dataset.meoLinkHref)
  }));
  assert.deepEqual(live.images.map(img => img.width).sort(), ['120px', '180px', '300px']);
  assert.equal(live.images.find(img => img.width === '300px')?.height, '200px');
  assert.ok(live.images.every(img => img.natural === 1200));
  assert.equal(live.text, text, 'rendering never rewrites authored Wiki syntax');
  assert.ok(live.links.some(href => href?.startsWith('meo-wiki:')), 'ordinary image references remain links');
  assert.ok(live.links.filter(href => href?.startsWith('meo-wiki:')).every(href => decodeURIComponent(href!.slice(9)) === 'assets/中文 图片.png'), 'escaped aliases in tables preserve the destination');
  assert.ok(await page.evaluate(() => (window as any).__wiki.resolutions.every((url: string) => url.startsWith('meo-wiki-image:') && !url.includes('literal') && !url.includes('code'))));

  const before = await page.evaluate(() => (window as any).__wiki.resolutions.length);
  stage = 'refresh existing Wiki images';
  await page.evaluate(() => { (window as any).__wiki.version = 2; (window as any).WikiHarness.refreshWikiImagePresentations(); });
  await page.waitForFunction(before => (window as any).__wiki.resolutions.length > before, {}, before);
  await page.waitForFunction(() => document.querySelectorAll('.meo-md-image-img').length === 3 && [...document.querySelectorAll<HTMLImageElement>('.meo-md-image-img')].every(img => decodeURIComponent(img.src).includes('#864')));
  await page.evaluate(() => (window as any).__wiki.editor.setMode('source'));
  assert.equal(await page.evaluate(() => (window as any).__wiki.editor.getText()), text);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.meo-md-image-img').length), 0, 'Source keeps source text without image projections');
  await page.evaluate(() => (window as any).__wiki.editor.setMode('live'));
  stage = 'return from Source to Live';
  await page.waitForFunction(() => document.querySelectorAll('.meo-md-image-img').length === 3);
  await page.evaluate(() => (window as any).__wiki.editor.destroy());
  const disposedCount = await page.evaluate(() => (window as any).__wiki.resolutions.length);
  await page.evaluate(() => (window as any).WikiHarness.refreshWikiImagePresentations());
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await page.evaluate(() => (window as any).__wiki.resolutions.length), disposedCount, 'destroyed widgets release refresh subscriptions');

  // Exercise the production image transport and its conflict fallback, then recover.
  stage = 'ambiguous image fallback';
  await page.evaluate(() => {
    const harness = (window as any).WikiHarness;
    harness.bindTooltips(document.body);
    harness.replaceWikiLinkStatuses([{ target: 'same', exists: false, issue: 'Wiki 目标重名，请补全路径：\na/same.md\nb/same.md' }]);
    (window as any).__ambiguous = true;
    harness.initializeImageHandling({ postMessage(message: any) {
      if (message.type !== 'resolveImageSrc') return;
      queueMicrotask(() => harness.settleImageSrcRequest({ type: 'resolvedImageSrc', requestId: message.requestId,
        result: (window as any).__ambiguous ? { ok: false, error: { code: 'operation-failed', message: 'Wiki 目标重名，请补全路径：\na/same.png\nb/same.png' } }
          : { ok: true, value: { resolvedUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>') } }
      }));
    } });
    harness.setImageSrcResolver(harness.resolveImageSrc);
    (window as any).__failureEditor = harness.createEditor({ parent: document.getElementById('app')!, text: 'Start\n\n![[same.png]]\n\n[[same|说明]]', initialMode: 'live', onApplyChanges() {} });
  });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.meo-md-image-fallback')?.dataset.tooltip?.includes('a/same.png'));
  for (const selector of ['.meo-md-image-fallback', '.meo-md-wiki-missing-icon']) {
    await page.mouse.move(0, 0);
    await page.hover(selector);
    await page.waitForSelector('.meo-tooltip.is-visible');
    const rows = await page.$eval('.meo-tooltip.is-visible .meo-tooltip-label', label => {
      const text = label.firstChild!;
      const content = text.textContent!;
      const range = document.createRange();
      return content.split('\n').map(line => {
        const from = content.indexOf(line);
        range.setStart(text, from);
        range.setEnd(text, from + line.length);
        return range.getBoundingClientRect().top;
      });
    });
    assert.equal(rows.length, 3);
    assert.ok(rows[0] < rows[1] && rows[1] < rows[2], 'each conflicting path occupies its own tooltip row');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { (window as any).__ambiguous = false; (window as any).WikiHarness.refreshWikiImagePresentations(); });
  stage = 'recover ambiguous image';
  await page.waitForSelector('.meo-md-image-img');
  assert.equal(await page.evaluate(() => document.querySelector<HTMLElement>('.meo-md-image')?.dataset.tooltip), undefined, 'recovery clears the stale conflict tooltip');
  stage = 'resolved image becomes ambiguous';
  await page.evaluate(() => { (window as any).__ambiguous = true; (window as any).WikiHarness.refreshWikiImagePresentations(); });
  await page.waitForFunction(() => document.querySelectorAll('.meo-md-image-img').length === 0 && document.querySelector<HTMLElement>('.meo-md-image-fallback')?.dataset.tooltip?.includes('a/same.png'));
  assert.equal(await page.evaluate(() => document.querySelector('.meo-md-image-fallback')?.textContent), '![[same.png]]', 'fallback keeps user-facing Wiki source');
  await page.evaluate(() => (window as any).__failureEditor.destroy());
  stage = 'Preview and export computed dimensions';
  const readingText = '![[image.png|300x200]]';
  const preview = exportRuntime.renderPreviewDocument({ markdownText: readingText, sourceDocumentPath: 'C:/fixture/note.md', uiLanguage: 'en' });
  const exported = await exportRuntime.renderExportHtmlDocument({ sourceDocumentPath: 'C:/fixture/note.md', outputFilePath: 'C:/fixture/output.html',
    wikiResources: { 'image.png': { uri: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') } },
    readingSnapshot: { snapshotId: 'wiki-dimensions', text: readingText, appearance: 'light', uiLanguage: 'en', environment: { previewSourceColoring: false } },
    target: 'html', mermaidRuntimeSrc: '', baseHref: '', title: 'Dimensions', shikiLanguageAssetsRoot: '' });
  for (const html of [`<style>${preview.styles.light}</style><div class="meo-export-doc">${preview.html}</div>`, exported.htmlDocument]) {
    await page.setContent(html);
    const size = await page.evaluate(() => { const rect = document.querySelector('img')!.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
    assert.deepEqual(size, { width: 300, height: 200 }, 'reading styles must preserve both explicit dimensions');
  }
  console.log('Wiki images in Live, tables, Source, refresh and conflict recovery production checks passed');
} catch (error) {
  console.error('Wiki production stage:', stage);
  if (diagnosticPage) console.error(await diagnosticPage.evaluate(() => ({ images: [...document.querySelectorAll<HTMLImageElement>('.meo-md-image-img')].map(img => ({ width: img.style.width, source: img.src })), fallbacks: [...document.querySelectorAll<HTMLElement>('.meo-md-image-fallback')].map(element => ({ text: element.textContent, tooltip: element.dataset.tooltip })), resolutions: (window as any).__wiki?.resolutions })));
  throw error;
} finally { await browser.close(); }
