import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchTestBrowser } from './browser-test-helpers';
import { defaultInputAssistance } from '../src/foundation/editingPreferences';
import { assessLargeDocument } from '../src/foundation/largeDocument';
import { encodeMarkdownPath } from '../src/foundation/linkDestination';
import { saveClipboardImageFile } from '../src/host/clipboardImageSave';
import type { SaveImageFromClipboardRequest } from '../src/protocol/clipboardImageSave';

const build = await Bun.build({ entrypoints: ['scripts/test-table-stability-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
const imageRoot = await mkdtemp(path.join(os.tmpdir(), 'meo-image-paste-'));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6L0AAAAASUVORK5CYII=', 'base64');
  await page.exposeFunction('__saveImageForReuse', async (message: SaveImageFromClipboardRequest, caseName: string) => {
    const saved = await saveClipboardImageFile({ documentFsPath: path.join(imageRoot, caseName, '重复 图片[甲]#50%.md'),
      extension: message.extension, contents: Buffer.from(message.imageData.split(',')[1], 'base64') });
    return { type: 'savedImagePath', requestId: message.requestId,
      result: { ok: true, value: { path: saved.relativePath, fileName: saved.fileName } } };
  });
  for (const mode of ['live', 'source']) for (const large of [false, true]) {
    const caseName = `${mode}-${large ? 'large' : 'ordinary'}`;
    const original = 'Before\n\n' + (large ? 'Plain filler.\n\n'.repeat(4_100) : '') + 'After\n\n';
    assert.equal(assessLargeDocument(original).boundedEditorWork, large);
    const result = await page.evaluate(async ({ mode, large, original, caseName, imageBase64 }) => {
      const scope = window as any, harness = scope.TableStabilityHarness;
      harness.setImageSrcResolver(() => 'data:image/png;base64,' + imageBase64);
      harness.initializeImageHandling({ postMessage(message: any) {
        if (message.type === 'saveImageFromClipboard') {
          void scope.__saveImageForReuse(message, caseName).then((response: any) => harness.handleSavedImagePath(response));
        }
      } });
      const editor = harness.createEditor({ parent: document.getElementById('app')!, text: original,
        initialMode: mode, onApplyChanges() {} });
      try {
        if (harness.usesLargeDocumentDerivedWorkBudget(editor.view.state) !== large) throw new Error('Wrong production work budget');
        editor.view.dispatch({ selection: { anchor: original.length }, scrollIntoView: true });
        editor.view.focus();
        const insertions: string[] = [];
        for (let index = 0; index < 2; index++) {
          const before = editor.getText();
          const clipboard = new DataTransfer();
          clipboard.items.add(new File([Uint8Array.from(atob(imageBase64), character => character.charCodeAt(0))], 'image.png', { type: 'image/png' }));
          const line = editor.view.state.doc.lineAt(editor.view.state.selection.main.head);
          await harness.handleImagePaste(new ClipboardEvent('paste', { clipboardData: clipboard }), editor,
            { lineNumber: line.number, lineOffset: editor.view.state.selection.main.head - line.from });
          insertions.push(editor.getText().slice(before.length));
        }
        const after = editor.getText();
        const focused = editor.view.hasFocus;
        const selection = editor.view.state.selection.main;
        const undoDepth = editor.getHistoryDepth().undo;
        for (let index = 0; index < undoDepth; index++) {
          if (!await editor.undo()) throw new Error('Image paste undo was not applied');
        }
        const undone = editor.getText();
        for (let index = 0; index < undoDepth; index++) {
          if (!await editor.redo()) throw new Error('Image paste redo was not applied');
        }
        return { insertions, after, undone, redone: editor.getText(), focused,
          selection: { from: selection.from, to: selection.to }, undoDepth };
      } finally { editor.destroy(); }
    }, { mode, large, original, caseName, imageBase64: png.toString('base64') });
    const fileName = '重复 图片[甲]#50%-1.png';
    const markdown = `![${fileName.replace(/[\\`*_[\]<>&]/g, '\\$&')}](${encodeMarkdownPath('assets/' + fileName)})`;
    assert.deepEqual(result.insertions, [markdown, markdown], caseName + ': repeated paste reuses the final Host path and name');
    assert.equal(result.after, original + markdown + markdown);
    assert.deepEqual(result.selection, { from: result.after.length, to: result.after.length });
    assert.ok(result.focused && result.undoDepth > 0, caseName + ': image paste retains editor focus and history');
    assert.equal(result.undone, original);
    assert.equal(result.redone, result.after);
    assert.deepEqual(await readdir(path.join(imageRoot, caseName, 'assets')), [fileName], caseName + ': only one image file exists');
    assert.deepEqual(await readFile(path.join(imageRoot, caseName, 'assets', fileName)), png);
  }
  await page.evaluate(() => (window as any).TableStabilityHarness.setImageSrcResolver((url: string) => url));
  const paths = [
    { raw: 'MDassets/设计资料/截图🖼️.png', destination: 'MDassets/设计资料/截图🖼️.png' },
    { raw: '设计 资料/截图(1)#50%&copy;.png', destination: '设计%20资料/截图%281%29%2350%25%26copy;.png' },
    { raw: '设计资料/字面%E8%AE%BE.png', destination: '设计资料/字面%25E8%25AE%25BE.png' },
    { raw: '中文资料/方案[甲]&copy;-1.png', destination: '中文资料/方案%5B甲%5D%26copy;-1.png' }
  ];
  for (const mode of ['live', 'source']) {
    for (const { raw, destination } of paths) {
      const pasted = await page.evaluate(async ({ mode, raw }) => {
        const harness = (window as any).TableStabilityHarness;
        harness.initializeImageHandling({ postMessage(message: any) {
          if (message.type === 'saveImageFromClipboard') queueMicrotask(() => harness.handleSavedImagePath({
            type: 'savedImagePath', requestId: message.requestId, result: { ok: true, value: { path: raw, fileName: raw.split('/').at(-1) } }
          }));
        } });
        const editor = harness.createEditor({ parent: document.getElementById('app')!, text: '', initialMode: mode, onApplyChanges() {} });
        editor.view.focus();
        const clipboard = new DataTransfer();
        clipboard.items.add(new File(['fixture'], 'image.png', { type: 'image/png' }));
        await harness.handleImagePaste(new ClipboardEvent('paste', { clipboardData: clipboard }), editor, { lineNumber: 1, lineOffset: 0 });
        const text = editor.getText();
        editor.destroy();
        return text;
      }, { mode, raw });
      assert.ok(pasted.startsWith('![' + raw.split('/').at(-1)!.replace(/[\\`*_[\]<>&]/g, '\\$&') + ']('), 'alt text uses the final Host file name with Markdown escaping');
      assert.ok(pasted.endsWith(`](${destination})`), `${mode} image paste: ${pasted}`);

      for (const prefix of ['![image](', '[link](']) {
        await page.evaluate(({ mode, raw, input }) => {
          const harness = (window as any).TableStabilityHarness;
          (window as any).__destinationEditor = harness.createEditor({ parent: document.getElementById('app')!, text: '', initialMode: mode,
            initialInputAssistance: { ...input, pairMode: 'off' },
            requestLinkCandidates: async () => [{ label: raw.split('/').at(-1), insert: raw, detail: raw }], onApplyChanges() {} });
          (window as any).__destinationEditor.view.focus();
        }, { mode, raw, input: defaultInputAssistance });
        await page.keyboard.type(prefix + 'test');
        await page.waitForSelector('.meo-input-suggestions:not([hidden])');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => (window as any).__destinationEditor.getText()), prefix + destination,
          `${mode}: path completion keeps readable Unicode and escapes filename punctuation`);
        await page.evaluate(() => (window as any).__destinationEditor.destroy());
      }
    }
  }

  const tablePaste = await page.evaluate(async () => {
    const harness = (window as any).TableStabilityHarness;
    harness.initializeImageHandling({ postMessage(message: any) {
      if (message.type === 'saveImageFromClipboard') queueMicrotask(() => harness.handleSavedImagePath({
        type: 'savedImagePath', requestId: message.requestId, result: { ok: true, value: { path: '表格图片/截图(1).png', fileName: '截图(1).png' } }
      }));
    } });
    const editor = harness.createEditor({ parent: document.getElementById('app')!, text: '| A | B |\n| --- | --- |\n|  | x |', initialMode: 'live', onApplyChanges() {} });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const input = document.querySelector<HTMLTextAreaElement>('tbody textarea')!;
    input.focus();
    const clipboard = new DataTransfer();
    clipboard.items.add(new File(['fixture'], 'image.png', { type: 'image/png' }));
    await harness.handleImagePaste(new ClipboardEvent('paste', { clipboardData: clipboard }), editor, { lineNumber: 3, lineOffset: 2 });
    const value = input.value;
    input.blur();
    const text = editor.getText();
    editor.destroy();
    return { value, text };
  });
  assert.ok(tablePaste.value.endsWith('](表格图片/截图%281%29.png)'), 'table cells use the same image destination policy');
  assert.ok(tablePaste.text.includes(tablePaste.value), 'the committed table source must retain the readable destination');

  for (const mode of ['live', 'source']) {
    const original = '![截图](设计资料/%E6%88%AA%E5%9B%BE.png)\n\n[链接](https://example.test/%E4%B8%AD%E6%96%87?q=%23#%E6%A0%87%E9%A2%98)';
    const unchanged = await page.evaluate(({ mode, original }) => {
      const editor = (window as any).TableStabilityHarness.createEditor({ parent: document.getElementById('app')!, text: original, initialMode: mode, onApplyChanges() {} });
      const text = editor.getText();
      editor.destroy();
      return text;
    }, { mode, original });
    assert.equal(unchanged, original, 'opening existing encoded links must preserve the authored document');
  }
  console.log('Unicode image paste, content reuse in ordinary/large Source and Live, history and path completion production checks passed');
} finally {
  try { await browser.close(); } finally {
    assert.equal(path.dirname(path.resolve(imageRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(imageRoot).startsWith('meo-image-paste-'));
    await rm(imageRoot, { recursive: true, force: true });
  }
}
