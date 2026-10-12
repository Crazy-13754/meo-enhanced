import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import exportRuntime from '../src/export/runtime';
import { PREVIEW_PRESET_STATE_KEY } from '../src/shared/preview';
import { decodeEditorCommand } from '../src/protocol/editorCommands';
import { createPanelSessionControllerParams, createPanelSessionTestDocument, createPanelSessionTestUri, createPanelSessionVscodeMock, panelSessionDisposable } from './panel-session-test-helper';

const document = createPanelSessionTestDocument(createPanelSessionTestUri('C:/tmp/preset-host.md'), 'first\nsecond');
mock.module('vscode', () => createPanelSessionVscodeMock(document));
const { createPanelSessionController } = await import('../src/extension/panelSession');
const { createPendingDraftRecovery } = await import('../src/application/pendingDraftRecovery');
const messages: any[] = [];
let receiveMessage: ((message: unknown) => void) | undefined;
const stored = new Map<string, unknown>();
const params = createPanelSessionControllerParams({
  panel: {
    active: true,
    webview: { postMessage: async (message: unknown) => { messages.push(message); return true; }, onDidReceiveMessage: (listener: (message: unknown) => void) => { receiveMessage = listener; return panelSessionDisposable(); } },
    onDidChangeViewState: () => panelSessionDisposable(), onDidDispose: () => panelSessionDisposable()
  },
  document,
  pendingDraftRecovery: createPendingDraftRecovery({ readCurrentText: () => document.text, applyDraft: async () => true }),
  readDiskText: () => document.text,
  overrides: {
    renderPreview: async (options: any) => exportRuntime.renderPreviewDocument(options),
    context: { globalState: { get: (key: string) => stored.get(key), update: async (key: string, value: unknown) => { stored.set(key, value); } } }
  }
});
const controller = createPanelSessionController(params as never);
try {
  const request = { type: 'requestPreviewRender', requestId: 'github', text: document.text, uiLanguage: 'en', environment: { previewFontFamily: 'Georgia', previewShowComments: true, previewSourceColoring: false }, preset: 'github-readme', contentWidth: 'reference' };
  receiveMessage!(request);
  await Bun.sleep(0);
  const github = messages.find(message => message.requestId === 'github').result.value;
  assert.equal(github.preset, 'github-readme');
  assert.ok(github.styles.light.includes('max-width: 1076px'));
  assert.ok(!github.html.includes('<br'));
  receiveMessage!({ ...request, requestId: 'default', preset: 'default', contentWidth: 'responsive' });
  await Bun.sleep(0);
  const original = messages.find(message => message.requestId === 'default').result.value;
  assert.equal(original.preset, 'default');
  assert.ok(original.html.includes('<br'));
  const count = messages.length;
  receiveMessage!({ ...request, requestId: 'invalid', preset: 'invalid' });
  await Bun.sleep(0);
  assert.equal(messages.length, count);
  await controller.handleMessage({ type: 'ready' });
  assert.equal(messages.findLast(message => message.type === 'init').previewPreset, undefined, 'An existing Webview can migrate its selection when Host memory is empty');
  assert.deepEqual(decodeEditorCommand({ type: 'setPreviewPreset', preset: 'whitey' }), { type: 'setPreviewPreset', preset: 'whitey' });
  assert.equal(decodeEditorCommand({ type: 'setPreviewPreset', preset: 'invalid' }), null);
  await controller.handleMessage({ type: 'setPreviewPreset', preset: 'newsprint' });
  assert.equal(stored.get(PREVIEW_PRESET_STATE_KEY), 'newsprint');
  await controller.handleMessage({ type: 'setPreviewPreset', preset: 'user:missing' });
  assert.equal(stored.get(PREVIEW_PRESET_STATE_KEY), 'newsprint', 'Unknown custom presets cannot become the startup default');
  const restarted = createPanelSessionController(params as never);
  try {
    await restarted.handleMessage({ type: 'ready' });
    assert.equal(messages.findLast(message => message.type === 'init').previewPreset, 'newsprint', 'A new Host session restores the last selection');
    stored.set(PREVIEW_PRESET_STATE_KEY, 'user:removed');
    await restarted.handleMessage({ type: 'ready' });
    assert.equal(messages.findLast(message => message.type === 'init').previewPreset, 'default', 'Removed presets fall back safely at startup');
  } finally { restarted.dispose(); }
  console.log('Preview preset Host request forwarding and validation tests passed.');
} finally {
  controller.dispose();
}
