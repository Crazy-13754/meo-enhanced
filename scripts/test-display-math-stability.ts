import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-mermaid-editing-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 950, height: 700 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: fs.readFileSync('node_modules/katex/dist/katex.min.css', 'utf8').replace(/url\((fonts\/[^)]+)\)/g,
    (_match, file) => `url(data:font/${path.extname(file).slice(1)};base64,${fs.readFileSync(path.join('node_modules/katex/dist', file)).toString('base64')})`) });
  await page.addStyleTag({ content: ':root{--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const settle = () => page.evaluate(async () => { await document.fonts.ready;
    for (let i = 0; i < 12; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const setup = async (mode: 'on' | 'relative' | 'interval' | 'off') => {
    await page.evaluate(mode => {
      const host = window as any;
      host.ed?.destroy(); document.querySelector('#app')!.replaceChildren();
      host.ed = host.MermaidEditingHarness.createEditor({ parent: document.querySelector('#app'),
        text: Array.from({ length: 30 }, (_, i) => 'Before ' + i).join('\n')
          + '\n\n$$\nx=1\ny=2\n$$\n\nAFTER_FORMULA\n'
          + Array.from({ length: 200 }, (_, i) => 'Tail ' + i).join('\n'),
        initialMode: 'live', sourceLineNumbers: mode, onApplyChanges() {} });
      host.ed.scrollToLine(31, 'center');
    }, mode); await settle();
  };
  await setup('on');
  await page.click('.meo-md-math-fenced-display .katex'); await settle();
  await page.evaluate(() => {
    const host = window as any;
    host.ids = new WeakMap(); host.count = 0;
    host.readGeometry = () => {
      const view = host.ed.view;
      const after = Array.from(view.contentDOM.querySelectorAll('.cm-line')).find((line: any) => line.textContent === 'AFTER_FORMULA') as HTMLElement;
      const preview = view.dom.querySelector('.meo-math-live-result') as HTMLElement;
      if (!host.ids.has(preview)) host.ids.set(preview, ++host.count);
      return { afterTop: after.getBoundingClientRect().top, height: preview.getBoundingClientRect().height,
        id: host.ids.get(preview), scroll: view.scrollDOM.scrollTop };
    };
  });
  for (const key of ['ArrowRight', 'ArrowLeft', 'a', 'Backspace', 'ArrowDown', 'ArrowUp']) {
    await page.evaluate(() => { const host = window as any; host.samples = [host.readGeometry()];
      const sample = () => { host.samples.push(host.readGeometry()); host.frame = requestAnimationFrame(sample); };
      host.frame = requestAnimationFrame(sample); });
    await page.keyboard.press(key); await settle();
    const samples = await page.evaluate(() => { const host = window as any;
      cancelAnimationFrame(host.frame); return host.samples as { afterTop: number; height: number; id: number; scroll: number }[]; });
    assert.equal(new Set(samples.map(sample => sample.id)).size, 1, `${key}: caret/input replaces the result DOM`);
    assert.ok(Math.max(...samples.map(sample => sample.afterTop)) - Math.min(...samples.map(sample => sample.afterTop)) < 0.1,
      `${key}: intermediate frames move document lines: ${JSON.stringify(samples)}`);
  }
  for (const mode of ['on', 'relative', 'interval', 'off'] as const) {
    await setup(mode);
    const result = await page.evaluate(() => { const view = (window as any).ed.view;
      view.dispatch({ selection: { anchor: view.state.doc.line(31).from } });
      return true; });
    assert.ok(result); await settle();
    const label = await page.$eval('.cm-editor', element => element.querySelector('.meo-rendered-block-preview-line-number')?.textContent ?? '');
    assert.equal(label, mode === 'on' ? '32' : mode === 'relative' ? '1' : '', `Collapsed math obeys ${mode} line numbers`);
  }
  // Markdown's quote/list deletion must not eat LaTeX source characters.
  for (const mode of ['source', 'live']) {
    await page.evaluate(mode => { const host = window as any; host.ed.destroy(); document.querySelector('#app')!.replaceChildren();
      host.ed = host.MermaidEditingHarness.createEditor({ parent: document.querySelector('#app'),
        text: 'Before\n\n> $$\n> x=1\n>\n> $$\n\nAfter', initialMode: mode, onApplyChanges() {} });
      host.ed.view.dispatch({ selection: { anchor: host.ed.view.state.doc.line(4).from + 1 } }); host.ed.view.focus();
    }, mode); await settle();
    await page.keyboard.type('Z'); await page.keyboard.press('Backspace'); await settle();
    assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.line(4).text), '> x=1', `${mode}: Backspace removes just the typed character`);
  }
  assert.deepEqual(errors, []);
  console.log('Display math stability passed: intermediate frames, DOM reuse, line-number modes and literal source deletion');
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
