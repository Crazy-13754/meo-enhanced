import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

// Distribute differences and blank targets across several CodeMirror viewports.
const current: string[] = [];
const original: string[] = [];
const targets: number[] = [];
for (let section = 0; section < 64; section++) {
  const lines = [
    `## Section ${section + 1}`, '',
    `Mixed Markdown paragraph ${section + 1}: **bold**, [link](https://example.com), inline $x^2$ and 中文内容。`, '',
    '- First item', '  - Nested item', '', '> Quote', '> ', '> Second paragraph', '',
    '```typescript', 'const result = value + 1;', '```', '',
    '$$', 'x = a + b', '', '$$', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
    '```mermaid', 'flowchart LR', '  A --> B --> C', '```', '', '   ', '',
    `End of section ${section + 1}.`, ''
  ];
  const old = [...lines];
  if (section % 4 === 0) {
    old[2] = ('Original paragraph with wrapped content. 修改前的长段落。 ').repeat(16);
    old.splice(4, 0, ...Array.from({ length: 9 }, (_, index) => `Removed line ${section}.${index}`), '');
    old[old.indexOf('x = a + b')] = 'x = a - b';
  } else if (section % 4 === 1) old.splice(11, 3);
  // Blank rows next to changed content and far from differences.
  if ([0, 1, 2, 7, 16, 23, 32, 47, 60, 63].includes(section)) {
    targets.push(current.length + 4, current.length + 18, current.length + 31);
  }
  current.push(...lines); original.push(...old);
}
const sampled = process.argv.includes('--sampled');
const sampledTargets = sampled ? targets.filter((_, index) => [0, 2, 9, 17, 23, 29].includes(index)) : targets;
const fixture = { text: current.join('\n'), base: original.join('\n'), targets: sampledTargets };
const highDpi = process.argv.includes('--hidpi');
const appearances = highDpi ? ['dark'] : ['light', 'dark'];
const widths = highDpi ? [1100] : [520, 1100];
fs.mkdirSync('.local/source-diff-caret', { recursive: true });
fs.writeFileSync('.local/source-diff-caret/long-fixture.json', JSON.stringify(fixture));
if (process.argv.includes('--fixtures-only')) process.exit(0);
const build = await Bun.build({ entrypoints: ['scripts/test-editor-stability-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
let checks = 0;
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><style>html,body{height:100%;margin:0}.editor-root,#app{height:100%}#outside{position:fixed;right:0;top:0}</style><div class="editor-root"><button id="outside">Outside</button><div id="app" class="editor-host"></div></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  // Freeze blinking, without overriding the real theme's caret color or geometry.
  await page.addStyleTag({ content: ':root{--vscode-editor-font-family:Consolas,monospace;--vscode-editor-font-size:14px;--git-added:#4caf7d;--git-deleted:#e05252}.cm-content{caret-animation:manual}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const check = async (label: string) => {
    await settle();
    const selected = await page.evaluate(() => {
      const host = window as any, view = host.ed.view, native = getSelection();
      const head = view.state.selection.main.head, rect = view.coordsAtPos(head)!;
      let nativeHead: number | null = null;
      try { if (native?.focusNode) nativeHead = view.posAtDOM(native.focusNode, native.focusOffset); } catch {}
      return { head, nativeHead, focus: view.hasFocus, empty: view.state.selection.main.empty,
        line: view.state.doc.lineAt(head).number, color: getComputedStyle(view.contentDOM).caretColor,
        nativeNode: native?.focusNode?.nodeName, nativeParent: native?.focusNode?.parentElement?.className,
        rootClass: document.documentElement.className, focusClass: document.querySelector('.editor-root')!.className,
        scrollTop: view.scrollDOM.scrollTop, viewport: view.viewport,
        clip: { x: Math.max(0, rect.left - 3), y: Math.max(0, rect.top), width: 8, height: Math.max(1, rect.bottom - rect.top) } };
    });
    assert.ok(selected.focus && selected.empty, `${label}: unfocused/non-collapsed ${JSON.stringify(selected)}`);
    assert.equal(selected.nativeHead, selected.head, `${label}: native/document positions differ ${JSON.stringify(selected)}`);
    const rgb = selected.color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.ok(rgb?.length === 3 && !selected.color.endsWith(', 0)'), `${label}: transparent caret ${selected.color}`);
    const { data, info } = await sharp(await page.screenshot({ clip: selected.clip })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let bestColumn = 0;
    for (let x = 0; x < info.width; x++) {
      let count = 0;
      for (let y = 0; y < info.height; y++) {
        const offset = (y * info.width + x) * info.channels;
        if (rgb!.every((value, channel) => Math.abs(data[offset + channel]! - value) < 40)) count++;
      }
      bestColumn = Math.max(bestColumn, count);
    }
    if (bestColumn < 8) {
      fs.mkdirSync('.local/source-diff-caret', { recursive: true });
      await page.screenshot({ path: '.local/source-diff-caret/long-caret-failure.png' });
      fs.writeFileSync('.local/source-diff-caret/long-caret-failure.json', JSON.stringify({ label, selected, bestColumn }, null, 2));
    }
    assert.ok(bestColumn >= 8, `${label}: caret not painted (column=${bestColumn}) ${JSON.stringify(selected)}`);
    checks++; return selected;
  };
  for (const appearance of appearances) for (const width of widths) {
    await page.setViewport({ width, height: 800, deviceScaleFactor: highDpi ? 1.5 : 1 });
    await page.evaluate(({ fixture, appearance }) => {
      const host = window as any;
      host.focusController?.dispose(); host.ed?.destroy(); document.querySelector('#app')!.replaceChildren();
      host.EditorStabilityHarness.applyBuiltInVisualBaseline(appearance);
      host.ed = host.EditorStabilityHarness.createEditor({ parent: document.querySelector('#app'), text: fixture.text,
        initialMode: 'source', onApplyChanges() {} });
      host.focusController = host.EditorStabilityHarness.createEditorFocusController({ root: document.querySelector('.editor-root'),
        getEditor: () => host.ed, isEditableMode: () => true });
      host.ed.setGitBaseline({ available: true, tracked: true, mode: 'current-edit', baseText: fixture.base });
    }, { fixture, appearance });
    for (const details of [false, true]) {
      await page.evaluate(details => { const host = window as any; host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, details); }, details);
      // Jump back and forth, rather than only scrolling monotonically downward.
      for (const [index, number] of fixture.targets.map((number, index) => [index, number] as const).sort((a, b) => (a[0] % 2 - b[0] % 2) || a[0] - b[0])) {
        await page.evaluate(number => (window as any).ed.scrollToLine(number, 'center'), number); await settle();
        if (index % 5 === 0) await page.focus('#outside');
        if (details && index % 7 === 0) {
          const oldRect = await page.evaluate(() => {
            const old = Array.from(document.querySelectorAll('.meo-git-diff-original-content')).find(element => {
              const rect = element.getBoundingClientRect(); return rect.top > 0 && rect.bottom < innerHeight;
            });
            if (!old) return null; const rect = old.getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
          });
          if (oldRect && oldRect.width > 5) {
            await page.mouse.move(oldRect.x + 1, oldRect.y + 5); await page.mouse.down();
            await page.mouse.move(oldRect.x + Math.min(oldRect.width - 1, 120), oldRect.y + 5, { steps: 3 }); await page.mouse.up();
          }
        }
        const point = await page.evaluate(({ number, index }) => {
          const view = (window as any).ed.view;
          const line = Array.from(view.contentDOM.querySelectorAll('.cm-line')).find((element: any) => view.state.doc.lineAt(view.posAtDOM(element)).number === number) as HTMLElement;
          if (!line) throw new Error('Missing virtualized row ' + number);
          const rect = line.getBoundingClientRect();
          return { x: rect.left + Math.max(5, rect.width * [0.01, 0.5, 0.95][index % 3]!), y: (rect.top + rect.bottom) / 2 };
        }, { number, index });
        await page.mouse.click(point.x, point.y);
        const label = `${appearance}/${width}/details=${details}/line=${number}`;
        const selected = await check(label + '/click'); assert.equal(selected.line, number, label + ': wrong row');
        const before = await page.evaluate(() => (window as any).ed.view.state.doc.toString());
        await page.keyboard.type('Z'); await check(label + '/type');
        assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before.slice(0, selected.head) + 'Z' + before.slice(selected.head), label + ': input misplaced');
        await page.keyboard.press('Backspace'); await check(label + '/delete');
        await page.keyboard.press('Enter'); await check(label + '/enter');
        await page.keyboard.press('Backspace'); await check(label + '/join');
        assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before, label + ': edit round trip');
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Source long document caret passed: ${current.length} lines, ${checks} painted-caret checks${sampled ? ' (sampled targets)' : ''}; real ${appearances.join('/')} themes, widths ${widths.join('/')}, scale ${highDpi ? 1.5 : 1}, original-content selection and distributed edits`);
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
