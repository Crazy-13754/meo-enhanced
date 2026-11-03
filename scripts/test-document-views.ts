import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { decodeHostToWebviewMessage } from '../src/protocol/messages';

class Disposable { constructor(private run: () => void) {} dispose() { this.run(); } }
class EventEmitter<T> {
  listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => { this.listeners.add(listener); return new Disposable(() => { this.listeners.delete(listener); }); };
  fire(value: T) { this.listeners.forEach(listener => listener(value)); }
  dispose() { this.listeners.clear(); }
}
class Uri {
  constructor(readonly value: string) {}
  static joinPath(uri: Uri, ...parts: string[]) { return new Uri([uri.value, ...parts].join('/')); }
  toString() { return this.value; }
}
mock.module('vscode', () => ({ Disposable, EventEmitter, Uri, extensions: { getExtension: (id: string) => id === 'test.markmap' ? { id, extensionUri: new Uri('file:///extension') } : undefined } }));
const { createDocumentViewsRegistry } = await import('../src/extension/documentViews');
const registry = createDocumentViewsRegistry();
const messages: any[] = [], ready = new EventEmitter<unknown>(), closed = new EventEmitter<void>();
let initialized = false;
const panel = { webview: { options: { enableScripts: true, localResourceRoots: [new Uri('file:///core')] }, onDidReceiveMessage: ready.event,
  asWebviewUri: (uri: Uri) => new Uri(uri.value.replace('file://', 'https://resource.test')),
  postMessage: async (event: unknown) => { assert(initialized); messages.push(event); return true; }
}, onDidDispose: closed.event };
let options = panel.webview.options, optionWrites = 0;
Object.defineProperty(panel.webview, 'options', { get: () => options, set: next => { options = next; optionWrites++; } });
registry.attach(panel as any, async () => { initialized = true; });
const descriptor = { id: 'mindmap', label: 'Mind map', labelZh: '思维导图', entry: 'dist/view.js', iconPaths: ['M2 12H22'], iconOffset: { x: -0.5, y: 0 }, codeBlockLanguages: ['markmap'] };
for (const codeBlockLanguages of [[], ['mermaid'], ['markmap', 'markmap'], ['<script>']]) {
  assert.throws(() => registry.api.registerDocumentView('test.markmap', { ...descriptor, codeBlockLanguages }));
}
for (const x of [NaN, Infinity, 2]) assert.throws(() => registry.api.registerDocumentView('test.markmap', { ...descriptor, iconOffset: { x, y: 0 } }));
assert.throws(() => registry.api.registerDocumentView('test.markmap', { ...descriptor, iconPaths: ['<svg onload="alert(1)">'] }));
for (const entry of ['../view.js', 'dist/../view.js', '/dist/view.js', 'https://untrusted/view.js']) {
  assert.throws(() => registry.api.registerDocumentView('test.markmap', { ...descriptor, entry }));
}
assert.throws(() => registry.api.registerDocumentView('missing', descriptor));
const contribution = registry.api.registerDocumentView('test.markmap', descriptor);
assert.throws(() => registry.api.registerDocumentView('test.markmap', { ...descriptor, id: 'duplicate-language' }));
assert.throws(() => registry.api.registerDocumentView('test.markmap', descriptor));
assert.equal(messages.length, 0);
ready.fire({ type: 'ready' }); await Promise.resolve(); await Promise.resolve();
assert.equal(messages.at(-1).views[0].id, 'test.markmap/mindmap');
assert.deepEqual(messages.at(-1).views[0].iconPaths, descriptor.iconPaths);
assert.deepEqual(messages.at(-1).views[0].iconOffset, descriptor.iconOffset);
assert.equal(panel.webview.options.localResourceRoots.length, 2);
assert.deepEqual(decodeHostToWebviewMessage(messages.at(-1)), messages.at(-1));
const writes = optionWrites;
ready.fire({ type: 'ready' }); await Promise.resolve(); await Promise.resolve();
assert.equal(optionWrites, writes, 'Repeated ready must not update Webview options and reload the editor');
assert.equal(decodeHostToWebviewMessage({ type: 'documentViewsChanged', views: [{ ...messages.at(-1).views[0], entryUri: 4 }] }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'documentViewsChanged', views: [{ ...messages.at(-1).views[0], iconOffset: { x: 4, y: 0 } }] }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'documentViewsChanged', views: [{ ...messages.at(-1).views[0], iconPaths: ['url(https://example.com)'] }] }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'documentViewsChanged', views: [messages.at(-1).views[0], messages.at(-1).views[0]] }), null);
contribution.dispose(); await Promise.resolve(); await Promise.resolve();
assert.deepEqual(messages.at(-1).views, []); assert.equal(panel.webview.options.localResourceRoots.length, 1);
closed.fire(); const count = messages.length;
registry.api.registerDocumentView('test.markmap', descriptor); ready.fire({ type: 'ready' }); await Promise.resolve();
assert.equal(messages.length, count); registry.dispose();
console.log('Document view registration, lifecycle, resource roots and protocol checks passed');
