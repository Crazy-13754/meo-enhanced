import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-mermaid-editing-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 850 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: ':root{--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px}' });
  await page.addScriptTag({ content: fs.readFileSync('webview/dist/mermaid.min.js', 'utf8') });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  await page.evaluate(() => { const host = window as any;
    host.ed = host.MermaidEditingHarness.createEditor({ parent: document.querySelector('#app'),
      text: 'Before\n\n- Parent\n\n  ```mermaid\n  flowchart LR\n  A --> B\n  ```\n\nAfter', initialMode: 'live', onApplyChanges() {} }); });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  await settle();
  await page.$eval('.meo-mermaid-mode-btn', element => (element as HTMLElement).click()); await settle();
  await page.evaluate(() => {
    const controller = (document.querySelector('.meo-mermaid-editing-block') as any).__meoMermaidEditingController;
    controller.innerView.dispatch({ selection: { anchor: controller.innerView.state.doc.length } });
    controller.innerView.focus();
  });
  for (const key of ['Enter', 'Tab', 'Backspace', 'X', 'Backspace']) { await page.keyboard.press(key); await settle(); }
  for (const key of ['z', 'y']) {
    await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); await settle();
  }
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const expected = await page.evaluate(key => {
      const outer = (window as any).ed.view;
      const controller = (outer.dom.querySelector('.meo-mermaid-editing-block') as any).__meoMermaidEditingController;
      const forward = key === 'ArrowDown' || key === 'ArrowRight';
      controller.innerView.dispatch({ selection: { anchor: forward ? controller.innerView.state.doc.length : 0 } });
      controller.innerView.focus();
      // Browser focus can expose its previous native range before selectionchange.
      // The editor must synchronize the newly dispatched document selection.
      const nativeFocus = outer.contentDOM.focus.bind(outer.contentDOM);
      outer.contentDOM.focus = options => {
        nativeFocus(options);
        const old = outer.domAtPos(0);
        const selection = getSelection()!;
        selection.setBaseAndExtent(old.node, old.offset, old.node, old.offset);
        outer.contentDOM.focus = nativeFocus;
      };
      return forward ? outer.state.doc.lineAt(controller.block.contentTo).number + 1
        : outer.state.doc.lineAt(controller.block.anchor).number;
    }, key);
    await page.keyboard.press(key); await settle();
    const actual = await page.evaluate(() => { const outer = (window as any).ed.view;
      return { line: outer.state.doc.lineAt(outer.state.selection.main.head).number, focus: outer.hasFocus }; });
    assert.equal(actual.line, expected, `${key}: native focus restored an old selection`);
    assert.equal(actual.focus, true);
  }
  console.log('Rendered source focus passed: four-way exit resists a stale native selection during focus');
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
