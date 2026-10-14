import assert from 'node:assert/strict';
import { launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-list-toolbar-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
const failures: string[] = [];
const errors: string[] = [];
const formats = [{ action: 'bulletList', prefix: '- ' }, { action: 'numberedList', prefix: '1. ' }, { action: 'task', prefix: '- [ ] ' }];
try {
  for (const mode of ['live', 'source']) {
    for (const font of ['Consolas', 'Arial']) {
      const page = await browser.newPage(); page.on('pageerror', error => errors.push(String(error)));
      await page.setViewport({ width: 1000, height: 700 });
      await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
      await page.addStyleTag({ path: 'webview/src/styles.css' });
      await page.addStyleTag({ content: `:root{--vscode-editor-font-family:${font},monospace;--vscode-editor-font-size:16px;--vscode-editor-font-weight:400}` });
      await page.addScriptTag({ content: 'window.acquireVsCodeApi=()=>({getState(){},setState(){},postMessage(){}})' });
      await page.addScriptTag({ content: await build.outputs[0].text() });
      const initialText = 'probe warmup';
      await page.evaluate(({ mode, text }) => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'init', documentId: 'file:///list-toolbar.md', text, version: 1, savedRevision: { version: 1, text }, diagnostics: [], mode, uiLanguage: 'en', sourceLineNumbers: 'on', editorAppearance: 'light', previewAppearance: 'auto', previewFontFamily: '', previewSourceColoring: true, gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260, vscodeTheme: null
      } })), { mode, text: initialText });
      await page.waitForFunction(mode => document.querySelector<HTMLElement>('.editor-root')?.dataset.mode === mode && !!document.querySelector('.editor-host > .cm-editor .cm-content'), {}, mode);
      const settle = () => page.evaluate(async () => {
        await document.fonts.ready;
        for (let index = 0; index < 6; index++) await new Promise(resolve => requestAnimationFrame(resolve));
      });
      await settle();
      const reset = async (text: string, anchor: number, head = anchor) => {
        await page.evaluate(({ text, anchor, head }) => {
          const harness = (window as any).ListToolbarHarness;
          const view = harness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: harness.EditorSelection.single(anchor, head), annotations: harness.Transaction.addToHistory.of(false) });
          view.focus();
        }, { text, anchor, head });
        await settle();
      };
      const state = () => page.evaluate(() => {
        const view = (window as any).ListToolbarHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
        return { text: view.state.doc.toString(), anchor: view.state.selection.main.anchor, head: view.state.selection.main.head, focused: view.hasFocus };
      });
      const click = async (action: string) => {
        await page.evaluate(action => {
          const view = (window as any).ListToolbarHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
          const read = () => {
            const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const start = node.textContent?.indexOf('probe') ?? -1;
              if (start < 0) continue;
              const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 1);
              return range.getBoundingClientRect().left;
            }
            return null;
          };
          (window as any).__listToolbarFrames = new Promise(resolve => {
            document.querySelector(`[data-action="${action}"]`)!.addEventListener('click', () => {
              const frames: (number | null)[] = [read()];
              const sample = () => requestAnimationFrame(() => {
                frames.push(read());
                if (frames.length === 10) resolve(frames); else sample();
              });
              sample();
            }, { capture: true, once: true });
          });
        }, action);
        await page.click(`[data-action="${action}"]`);
        return await page.evaluate(() => (window as any).__listToolbarFrames) as (number | null)[];
      };
      const check = (actual: unknown, expected: unknown, label: string) => {
        try { assert.deepEqual(actual, expected); } catch { failures.push(`${mode}/${font}/${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
      };
      for (const { action, prefix } of formats) {
        await reset('', 0); await click(action);
        check(await state(), { text: prefix, anchor: prefix.length, head: prefix.length, focused: true }, `${action}/empty`);
        await page.keyboard.type('probe'); await settle();
        check((await state()).text, prefix + 'probe', `${action}/type after marker`);
        for (const position of [0, 2]) {
          await reset('  ', position); await click(action);
          check(await state(), { text: '  ' + prefix, anchor: 2 + prefix.length, head: 2 + prefix.length, focused: true }, `${action}/indented blank ${position}`);
        }
        const text = 'probe content';
        for (const position of [0, 6, text.length]) {
          await reset(text, position); const frames = await click(action);
          check(await state(), { text: prefix + text, anchor: prefix.length + position, head: prefix.length + position, focused: true }, `${action}/caret ${position}`);
          const marker = action === 'task' ? '.meo-task-checkbox' : action === 'bulletList' ? '.meo-md-list-marker-bullet-dot' : '.meo-md-list-marker-ordered';
          check(await page.$$eval('.editor-host > .cm-editor ' + marker, nodes => nodes.length), mode === 'live' ? 1 : 0, `${action}/rendered marker`);
          if (mode === 'live' && frames.every(frame => frame !== null)) {
            const start = frames[0]!; const end = frames.at(-1)!;
            if (frames.some(frame => frame! < Math.min(start, end) - 0.75 || frame! > Math.max(start, end) + 0.75)) failures.push(`${mode}/${font}/${action}/overshoot: ${JSON.stringify(frames)}`);
          }
        }
        await reset('  ' + text, 0); await click(action);
        check(await state(), { text: '  ' + prefix + text, anchor: 2 + prefix.length, head: 2 + prefix.length, focused: true }, `${action}/indented paragraph start`);
        const parent = '- parent\n';
        await reset(parent + '  ' + text, parent.length); await click(action);
        check(await state(), { text: parent + '  ' + prefix + text, anchor: parent.length + 2 + prefix.length, head: parent.length + 2 + prefix.length, focused: true }, `${action}/nested line start`);
        await reset(text, 0); await click(action); await click(action);
        check(await state(), { text, anchor: 0, head: 0, focused: true }, `${action}/toggle off`);
        await page.evaluate(() => { const harness = (window as any).ListToolbarHarness; harness.undo(harness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'))); }); await settle();
        check((await state()).text, prefix + text, `${action}/undo one click`);
        await page.evaluate(() => { const harness = (window as any).ListToolbarHarness; harness.redo(harness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'))); }); await settle();
        check((await state()).text, text, `${action}/redo`);
        const multiline = 'probe one\nprobe two\nprobe three';
        const last = multiline.indexOf('\nprobe three');
        const second = action === 'numberedList' ? '2. ' : prefix;
        const expected = prefix + 'probe one\n' + second + 'probe two\nprobe three';
        for (const reversed of [false, true]) {
          await reset(multiline, reversed ? last : 0, reversed ? 0 : last); await click(action);
          check(await state(), { text: expected, anchor: reversed ? last + prefix.length + second.length : prefix.length, head: reversed ? prefix.length : last + prefix.length + second.length, focused: true }, `${action}/multiline ${reversed}`);
        }
        for (const from of formats.filter(format => format.action !== action)) {
          for (const position of [0, from.prefix.length + 6]) {
            const target = position === 0 ? prefix.length : prefix.length + 6;
            await reset(from.prefix + text, position); await click(action);
            check(await state(), { text: prefix + text, anchor: target, head: target, focused: true }, `${from.action} to ${action}/caret ${position}`);
          }
        }
      }
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log('List toolbar: empty/nonempty caret, immediate marker layout, toggle/conversion, multiline directions, typing, undo/redo in Live/Source with mono/proportional fonts passed.');
} finally { await browser.close(); }
