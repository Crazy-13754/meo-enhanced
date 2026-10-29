import assert from 'node:assert/strict';
import type { Browser } from 'puppeteer-core';

/** Full bootstrap, toolbar confirmation, Host reload response and presentation acknowledgement. */
export async function checkHtmlDocumentReload(browser: Browser, bundlePath: string): Promise<void> {
  const disk = '<div>\n<p>Paragraph **bold**.</p>\n\n- Markdown list\n\n</div>\n\n## Next heading\n\n$$\nx^2 + 1\n$$\n\n<svg width="300" height="140" viewBox="0 0 300 140"><text x="10" y="30">Image</text></svg>\n\nAfter.';
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.setViewport({ width: 1100, height: 1000 });
    await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}</style><div id="app"></div>');
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.evaluate(text => {
      const g = window as any;
      g.htmlReloadText = text; g.htmlReloadRequests = 0; g.htmlReloadCompleted = 0;
      g.acquireVsCodeApi = () => ({ getState() {}, setState() {}, postMessage(message: any) {
        if (message.type === 'reloadDocumentFromDisk') {
          const reloadId = ++g.htmlReloadRequests;
          setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'documentReloadedFromDisk', reloadId, version: reloadId + 1, text: g.htmlReloadText,
            topLine: message.topLine, topLineOffset: message.topLineOffset
          } })), 0);
        }
        if (message.type === 'documentReloadPresentationCompleted' && message.presented) g.htmlReloadCompleted++;
      } });
    }, disk);
    await page.addScriptTag({ path: bundlePath });
    await page.evaluate(text => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'init', documentId: 'file:///html-reload.md', text, version: 1, savedRevision: { version: 1, text }, diagnostics: [], mode: 'live',
      uiLanguage: 'en', sourceLineNumbers: 'on', previewAppearance: 'light', previewFontFamily: '', previewSourceColoring: true,
      editorAppearance: 'light', gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false,
      diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
      findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260, vscodeTheme: null
    } })), disk);
    await page.waitForFunction(() => !document.querySelector('.meo-preload-editor-shell') && !!document.querySelector('.meo-md-html-content svg[viewBox]'));
    for (const invalid of [false, true]) {
      await page.evaluate(invalid => {
        const view = (window as any).__viewportTestView(), source = view.state.doc.toString();
        const first = invalid ? source.indexOf('</div>') : source.indexOf('Paragraph');
        view.dispatch({ changes: { from: first, to: first + (invalid ? 6 : 9), insert: invalid ? '' : 'Edited paragraph' }, userEvent: 'input.type' });
        const next = view.state.doc.toString(), from = next.indexOf('Image');
        view.dispatch({ changes: { from, to: from + 5, insert: 'Edited image' }, selection: { anchor: from + 3 }, userEvent: 'input.type' });
        view.focus();
      }, invalid);
      await page.waitForSelector('.meo-md-html-source-range');
      const before = await page.evaluate(() => (window as any).htmlReloadRequests);
      await page.click('[data-action="discard"]'); await page.click('[data-action="discard"]');
      await page.waitForFunction(count => (window as any).htmlReloadCompleted === count + 1, {}, before);
      await page.waitForFunction(() => document.querySelectorAll('.meo-md-html-source-invalid').length === 0
        && document.querySelectorAll('.meo-md-html-content svg[viewBox]').length === 1
        && document.querySelectorAll('.meo-md-math-fenced-display').length === 1);
      assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), disk);
      assert.equal(await page.evaluate(() => (window as any).htmlReloadRequests), before + 1, 'One confirmed toolbar reload is sufficient');
      assert.equal(await page.$$eval('.meo-md-html-source-range', nodes => nodes.some(node => node.textContent?.includes('## Next heading'))), false);
    }
    assert.deepEqual(errors, []);
    console.log('HTML toolbar reload: one Host roundtrip restores disjoint edits and unfinished markup without stale ranges or duplicate previews');
  } finally { await page.close(); }
}
