import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({
  entrypoints: ['scripts/test-editor-stability-entry.ts'],
  target: 'browser',
  format: 'iife',
});
assert.ok(build.success, build.logs.map(String).join('\n'));

const browser = await launchTestBrowser();
let primaryError: unknown;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 950, height: 800 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ path: 'node_modules/katex/dist/katex.min.css' });
  await page.addStyleTag({ content: ':root{--meo-background:white;--meo-foreground:#24292e;--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });

  const settle = () => page.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
  let drags = 0;
  for (const prefix of ['', '> ']) {
    for (const backwards of [false, true]) {
      await page.evaluate(prefix => {
        const host = window as any;
        host.ed?.destroy();
        document.querySelector('#app')!.replaceChildren();
        host.ed = host.EditorStabilityHarness.createEditor({
          parent: document.querySelector('#app'),
          uiLanguage: 'zh-CN',
          text: `Before\n\n${prefix}$$\n${prefix}x^2+y^2=z^2\n${prefix}$$\n\nAfter`,
          initialMode: 'live',
          onApplyChanges() {},
        });
      }, prefix);
      await settle();
      await page.click('.meo-md-math-fenced-display');
      await settle();

      const points = await page.evaluate(backwards => {
        const view = (window as any).ed.view;
        const from = view.coordsAtPos(view.state.doc.line(4).from)!;
        const to = view.coordsAtPos(view.state.doc.line(7).to)!;
        const start = { x: from.left + 1, y: (from.top + from.bottom) / 2 };
        const end = { x: to.left, y: (to.top + to.bottom) / 2 };
        return backwards ? [end, start] : [start, end];
      }, backwards);
      await page.mouse.move(points[0]!.x, points[0]!.y);
      await page.mouse.down();
      await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 20 });
      await page.mouse.up();
      await settle();

      const selected = await page.evaluate(() => {
        const view = (window as any).ed.view;
        const data = new DataTransfer();
        const event = new ClipboardEvent('copy', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(event);
        return {
          native: getSelection()?.toString() ?? '',
          source: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
          copied: data.getData('text/plain'),
          handled: event.defaultPrevented,
        };
      });
      fs.mkdirSync('.local/display-math', { recursive: true });
      await page.screenshot({
        path: `.local/display-math/drag-${prefix ? 'quote' : 'plain'}-${backwards ? 'up' : 'down'}.png`,
      });
      assert.ok(selected.source.includes('x^2+y^2=z^2'), JSON.stringify(selected));
      assert.equal(selected.copied, selected.source, 'Copy must contain the selected Markdown source only');
      assert.ok(selected.handled, 'Editor must own document copying');
      assert.ok(selected.native.includes('x^2+y^2=z^2'), 'Document drag must still select the editable source');
      assert.ok(!selected.native.includes('预览'), 'Document drag must exclude the result label: ' + JSON.stringify(selected));
      assert.ok(!selected.native.replace(/\s/g, '').includes('x2+y2=z2'), 'Document drag must exclude rendered formula text: ' + JSON.stringify(selected));
      drags++;
    }
  }
  console.log(`Display math drag selection passed: ${drags} document drags exclude the result label and formula; source copying remains correct`);
} catch (error) {
  primaryError = error;
} finally {
  if (primaryError === undefined) await closeTestBrowser(browser);
  else await closeTestBrowser(browser, primaryError);
}
