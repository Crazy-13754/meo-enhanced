import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-editor-stability-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 950, height: 900 });
  await page.setContent('<!doctype html><style>html,body{height:100%;margin:0}.editor-root,#app{height:100%}#outside{position:fixed;right:0;top:0}</style><div class="editor-root"><button id="outside">Outside</button><div id="app" class="editor-host"></div></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: ':root{--meo-background:white;--meo-foreground:#24292e;--meo-caret-color:#ff00ff;--vscode-editorCursor-foreground:#ff00ff;--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px;--git-added:#4caf7d;--git-deleted:#e05252}.cm-content{caret-animation:manual}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  let clicks = 0;
  for (const pathway of ['source', 'live-to-source', 'live-edit-to-source']) for (const details of [false, true]) {
    await page.evaluate(({ pathway, details }) => { const host = window as any;
      host.focusController?.dispose(); host.ed?.destroy(); document.querySelector('#app')!.replaceChildren();
      host.ed = host.EditorStabilityHarness.createEditor({ parent: document.querySelector('#app'),
        text: 'Before\n\n$$\nx=1\n\n\n$$\n\n   \n\nAfter\n', initialMode: pathway === 'source' ? 'source' : 'live', onApplyChanges() {} });
      host.focusController = host.EditorStabilityHarness.createEditorFocusController({ root: document.querySelector('.editor-root'),
        getEditor: () => host.ed, isEditableMode: () => true });
      host.ed.setGitBaseline({ available: true, tracked: true, mode: 'current-edit', baseText: 'Before\nold text\n\n$$\nx=0\n$$\n\nAfter\nold end\n' });
      host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, details);
      if (pathway === 'live-to-source') host.ed.setMode('source');
    }, { pathway, details }); await settle();
    if (pathway === 'live-edit-to-source') {
      await page.click('.meo-md-math-fenced-display'); await settle();
      await page.keyboard.type('y');
      await page.evaluate(() => { const view = (window as any).ed.view;
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        (window as any).ed.setMode('source'); }); await settle();
    }
    for (const number of [2, 5, 6, 8, 9, 10, 12]) for (const fraction of [0.01, 0.5, 0.95]) {
      // Focus away first: selection inside an already focused editor is a weaker check.
      if (details && fraction === 0.5) {
        const old = await page.$('.meo-git-diff-original-content');
        if (old) {
          const rect = await old.boundingBox();
          if (rect) { await page.mouse.move(rect.x + 1, rect.y + rect.height / 2); await page.mouse.down();
            await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 5 }); await page.mouse.up(); }
        }
      } else await page.focus('#outside');
      const point = await page.evaluate(({ number, fraction }) => { const view = (window as any).ed.view;
        const line = Array.from(view.contentDOM.querySelectorAll('.cm-line')).find((element: any) => view.state.doc.lineAt(view.posAtDOM(element)).number === number) as HTMLElement;
        const rect = line.getBoundingClientRect();
        return { x: rect.left + Math.max(5, rect.width * fraction), y: (rect.top + rect.bottom) / 2 };
      }, { number, fraction });
      await page.mouse.click(point.x, point.y); await settle();
      const selected = await page.evaluate(() => { const view = (window as any).ed.view, native = getSelection();
        const rect = view.coordsAtPos(view.state.selection.main.head)!;
        const gutter = view.scrollDOM.querySelector(':scope > .cm-gutters')?.getBoundingClientRect();
        return { focus: view.hasFocus, line: view.state.doc.lineAt(view.state.selection.main.head).number,
          head: view.state.selection.main.head, empty: view.state.selection.main.empty,
          nativeHead: native?.focusNode ? view.posAtDOM(native.focusNode, native.focusOffset) : null,
          nativeNode: native?.focusNode?.nodeName, nativeParent: native?.focusNode?.parentElement?.className,
          // A native line-start caret straddles its logical x. The sticky,
          // opaque gutter must not cover its painted left edge after rounding.
          gutterClearance: gutter ? rect.left - gutter.right : null,
          clip: { x: Math.max(0, rect.left - 3), y: Math.max(0, rect.top), width: 8, height: Math.max(1, rect.bottom - rect.top) } };
      });
      const label = `${pathway}/details=${details}/line=${number}/x=${fraction}`;
      assert.ok(selected.focus && selected.empty, label + ': no editable caret ' + JSON.stringify(selected));
      assert.equal(selected.line, number, label + ': wrong row');
      assert.equal(selected.nativeHead, selected.head, label + ': native caret disagrees with document');
      assert.ok(selected.gutterClearance === null || selected.gutterClearance >= 1,
        label + ': sticky gutter overlaps the line-start caret ' + JSON.stringify(selected));
      const png = await page.screenshot({ clip: selected.clip });
      const pixels = await sharp(png).removeAlpha().raw().toBuffer();
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 3) if (pixels[i]! > 180 && pixels[i + 1]! < 90 && pixels[i + 2]! > 180) painted++;
      if (!painted) { fs.mkdirSync('.local/source-diff-caret', { recursive: true });
        await page.screenshot({ path: '.local/source-diff-caret/empty-line-caret-failure.png' }); }
      assert.ok(painted >= 5, label + ': native caret was not painted ' + JSON.stringify(selected));
      const before = await page.evaluate(() => (window as any).ed.view.state.doc.toString());
      await page.keyboard.type('Z');
      assert.equal(await page.evaluate(() => (window as any).ed.view.state.doc.toString()), before.slice(0, selected.head) + 'Z' + before.slice(selected.head), label);
      await page.keyboard.press('Backspace'); await settle(); clicks++;
    }
  }
  console.log(`Source empty line caret passed: ${clicks} clicks, native/document position, painted caret and input`);
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
