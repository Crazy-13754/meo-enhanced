import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-editor-stability-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: ':root{--meo-background:white;--meo-foreground:#24292e;--meo-caret-color:#24292e;--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px;--git-added:#4caf7d;--git-deleted:#e05252}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 6; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const fixtures = [
    { name: 'math-replacement', current: 'Before\n\n$$\nf(x)=a-b \\tag{1.122211} 222\n\n\n$$\n\n$$\n\n\n$$x^2$$\n\n## Heading\n\n是的 $ f(x) = a+b $\n\nAfter',
      original: 'Before\n\n$$\nf(x)=a-b \\tag{1.122211}\n$$\n\n## Heading\n\nAfter' },
    { name: 'wrapped-original', current: 'first\n\ncurrent replacement\n\nlast',
      original: 'first\n' + '修改前的原始内容 old text '.repeat(30) + '\nold two\n\nlast' },
    { name: 'deletion-boundaries', current: '\nfirst\n\nsecond\n\nlast\n',
      original: 'removed start\n\nfirst\nremoved middle\n\nsecond\n\nlast\nremoved end\n' }
  ];
  let clicks = 0;
  for (const width of [520, 1100]) {
    await page.setViewport({ width, height: 950 });
    for (const fixture of fixtures) for (const pathway of ['source', 'live-to-source']) {
      await page.evaluate(({ fixture, pathway }) => {
        const host = window as any;
        host.ed?.destroy(); document.querySelector('#app')!.replaceChildren();
        host.ed = host.EditorStabilityHarness.createEditor({ parent: document.querySelector('#app'), text: fixture.current,
          initialMode: pathway === 'source' ? 'source' : 'live', onApplyChanges() {} });
        host.ed.setGitBaseline({ available: true, tracked: true, mode: 'current-edit', baseText: fixture.original });
        host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, false);
        if (pathway !== 'source') host.ed.setMode('source');
      }, { fixture, pathway }); await settle();
      for (const details of [false, true, false, true]) {
        await page.evaluate(details => { const host = window as any;
          host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, details); }, details); await settle();
        assert.equal(await page.$eval('.cm-content', element => element.getAttribute('contenteditable')), 'true');
        for (let number = 1; number <= fixture.current.split('\n').length; number++) {
          await page.evaluate(number => (window as any).ed.scrollToLine(number, 'center'), number); await settle();
          // Start with an original-text selection, then return to the adjacent editable row.
          if (details) await page.evaluate(() => {
            const original = document.querySelector('.meo-git-diff-original-content');
            if (!original) return;
            const range = document.createRange(); range.selectNodeContents(original);
            getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
            document.documentElement.classList.add('meo-git-diff-selecting-original');
          });
          const point = await page.evaluate(number => {
            const view = (window as any).ed.view;
            const line = Array.from(view.contentDOM.querySelectorAll('.cm-line')).find((element: any) => view.state.doc.lineAt(view.posAtDOM(element)).number === number) as HTMLElement;
            assertExists(line);
            const rect = line.getBoundingClientRect();
            return { x: rect.left + 5, y: rect.top + Math.min(rect.height / 2, 10) };
            function assertExists(value: unknown): asserts value { if (!value) throw new Error('Missing current source line ' + number); }
          }, number);
          await page.mouse.click(point.x, point.y); await settle();
          const selected = await page.evaluate(() => { const view = (window as any).ed.view;
            return { focus: view.hasFocus, line: view.state.doc.lineAt(view.state.selection.main.head).number,
              head: view.state.selection.main.head, empty: view.state.selection.main.empty,
              caret: getComputedStyle(view.contentDOM).caretColor,
              originalDomain: document.documentElement.classList.contains('meo-git-diff-selecting-original') }; });
          const label = `${fixture.name}/${width}/${pathway}/details=${details}/line=${number}`;
          assert.ok(selected.focus && selected.empty && !selected.originalDomain, label + ': no editable caret ' + JSON.stringify(selected));
          assert.equal(selected.line, number, label + ': clicked the wrong row');
          assert.notEqual(selected.caret, 'rgba(0, 0, 0, 0)', label + ': hidden caret');
          const before = await page.evaluate(() => (window as any).ed.view.state.doc.toString());
          await page.keyboard.type('Z');
          assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before.slice(0, selected.head) + 'Z' + before.slice(selected.head), label + ': input did not reach the caret');
          await page.keyboard.press('Backspace'); await settle();
          assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before, label + ': source deletion changed other characters');
          clicks++;
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  for (const width of [520, 1100]) {
    await page.setViewport({ width, height: 950 });
    await page.evaluate(() => { const host = window as any; host.ed.destroy(); document.querySelector('#app')!.replaceChildren();
      host.ed = host.EditorStabilityHarness.createEditor({ parent: document.querySelector('#app'),
        text: 'first\n' + '当前正文 current text '.repeat(18) + '\n\nlast', initialMode: 'source', onApplyChanges() {} });
      host.ed.setGitBaseline({ available: true, tracked: true, mode: 'current-edit',
        baseText: 'first\n' + '修改前 old text '.repeat(20) + '\nold extra\n\nlast' });
    }); await settle();
    for (const details of [true, false, true, false, true]) {
      // Deliberately click before CodeMirror's next measurement frame.
      await page.evaluate(details => { const host = window as any;
        host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, details); }, details);
      const points = await page.evaluate(() => {
        const view = (window as any).ed.view;
        const line = Array.from(view.contentDOM.querySelectorAll('.cm-line')).find((element: any) => view.state.doc.lineAt(view.posAtDOM(element)).number === 2) as HTMLElement;
        const range = document.createRange(); range.selectNodeContents(line);
        const rows = new Map<number, { x: number; y: number }>();
        for (const rect of range.getClientRects()) if (rect.width > 3 && rect.height > 3)
          rows.set(Math.round(rect.top), { x: rect.left + Math.min(4, rect.width / 2), y: (rect.top + rect.bottom) / 2 });
        return [...rows.values()];
      });
      assert.ok(points.length > 1, 'Fixture must wrap across visual rows');
      for (const point of points) {
        await page.mouse.click(point.x, point.y);
        const selected = await page.evaluate(() => { const view = (window as any).ed.view;
          return { focus: view.hasFocus, head: view.state.selection.main.head, line: view.state.doc.lineAt(view.state.selection.main.head).number }; });
        assert.ok(selected.focus && selected.line === 2, `Rapid details toggle/wrapped row: ${JSON.stringify({ width, details, point, selected })}`);
        const before = await page.evaluate(() => (window as any).ed.view.state.doc.toString());
        await page.keyboard.type('Z');
        assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before.slice(0, selected.head) + 'Z' + before.slice(selected.head));
        await page.keyboard.press('Backspace'); clicks++;
      }
    }
  }
  assert.deepEqual(errors, []);
  fs.mkdirSync('.local/source-diff-caret', { recursive: true });
  await page.screenshot({ path: '.local/source-diff-caret/source-with-original.png' });
  console.log(`Source diff caret passed: ${clicks} clicks, details toggles, original/current selection, formula boundaries and wrapped/deleted rows`);
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
