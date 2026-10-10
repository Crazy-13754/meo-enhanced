import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import exportRuntime from '../src/export/runtime';
import { createPanelSessionControllerParams, createPanelSessionTestDocument, createPanelSessionTestUri, createPanelSessionVscodeMock, panelSessionDisposable } from './panel-session-test-helper';

const document = createPanelSessionTestDocument(createPanelSessionTestUri('C:/tmp/preset-host.md'), 'first\nsecond');
mock.module('vscode', () => createPanelSessionVscodeMock(document));
const { createPanelSessionController } = await import('../src/extension/panelSession');
const { createPendingDraftRecovery } = await import('../src/application/pendingDraftRecovery');
const messages: any[] = [];
let receiveMessage: ((message: unknown) => void) | undefined;
const controller = createPanelSessionController(createPanelSessionControllerParams({
  panel: {
    active: true,
    webview: { postMessage: async (message: unknown) => { messages.push(message); return true; }, onDidReceiveMessage: (listener: (message: unknown) => void) => { receiveMessage = listener; return panelSessionDisposable(); } },
    onDidChangeViewState: () => panelSessionDisposable(), onDidDispose: () => panelSessionDisposable()
  },
  document,
  pendingDraftRecovery: createPendingDraftRecovery({ readCurrentText: () => document.text, applyDraft: async () => true }),
  readDiskText: () => document.text,
  overrides: { renderPreview: async (options: any) => exportRuntime.renderPreviewDocument(options) }
}) as never);
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
  console.log('Preview preset Host request forwarding and validation tests passed.');
} finally {
  controller.dispose();
}
