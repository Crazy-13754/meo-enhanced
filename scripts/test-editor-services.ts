import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { URI, Utils } from 'vscode-uri';
import { decodeEditorServiceRequest, decodeEditorServiceResponse } from '../src/protocol/editorServices';
import { createEditorServicesTransport } from '../webview/src/adapters/editorServicesTransport';
let clipboard = '', disposed = 0, created = 0, uris: URI[] = [], file = '';
const stats: string[] = [], root = URI.file('D:/workspace');
class CancellationTokenSource {
  constructor() { created++; }
  private cancelled = false;
  get token() { const source = this; return { get isCancellationRequested() { return source.cancelled; } }; }
  cancel() { this.cancelled = true; }
  dispose() { disposed++; }
}
mock.module('vscode', () => ({ CancellationTokenSource, FileType: { File: 1, Directory: 2 },
  Uri: { file: URI.file, parse: URI.parse, joinPath: Utils.joinPath }, RelativePattern: class {},
  env: { clipboard: { readText: async () => clipboard, writeText: async (text: string) => { clipboard = text; } } },
  workspace: { findFiles: async () => uris, getWorkspaceFolder: () => ({ uri: root }),
    createFileSystemWatcher: () => ({ onDidCreate() {}, onDidDelete() {}, onDidChange() {}, dispose() {} }),
    fs: { readFile: async () => new TextEncoder().encode(file), stat: async (uri: URI) => {
      stats.push(uri.path); if (!uris.some(value => value.toString() === uri.toString())) throw new Error('not found'); return { type: 1, size: file.length };
    }, readDirectory: async () => uris.map(uri => [uri.path.split('/').at(-1), 1]) },
    asRelativePath: (uri: URI) => uri.path } }));
const { runEditorService } = await import('../src/host/editorServices');
const doc = URI.file('D:/workspace/main.md') as any;
const request = (change: object) => ({ type: 'editorService', requestId: 'request', ...change } as any);
assert.equal(decodeEditorServiceRequest(request({ action: 'writeClipboard', text: 'x'.repeat(5_000_001) })), null);
assert.equal(decodeEditorServiceRequest(request({ action: 'links', kind: 'bad', query: '', target: '' })), null);
assert.equal(decodeEditorServiceResponse({ type: 'editorServiceResult', requestId: 'x', result: { ok: true, value: { candidates: Array(51).fill({ label: '', insert: '', detail: '' }) } } }), null);
assert.equal((await runEditorService(request({ action: 'writeClipboard', text: 'A\tB' }), doc)).result.ok, true);
const read = await runEditorService(request({ action: 'readClipboard' }), doc); assert.deepEqual(read.result, { ok: true, value: { text: 'A\tB' } });
clipboard = 'x'.repeat(5_000_001); assert.equal((await runEditorService(request({ action: 'readClipboard' }), doc)).result.ok, false);
uris = [URI.file('D:/workspace/notes/target.md')];
file = '# Visible\n```\n# Hidden\n```\n## Other ###\n';
const headings = await runEditorService(request({ action: 'links', kind: 'headings', query: '', target: 'notes/target' }), doc);
assert.deepEqual(headings.result.ok && 'candidates' in headings.result.value ? headings.result.value.candidates.map(value => value.label) : null, ['Visible', 'Other']);
assert.ok(stats.some(value => value.endsWith('/notes/target.md')));
file = '# Hello **world**\n\n# Hello **world**\n\nSetext\n======';
const formatted = await runEditorService(request({ action: 'links', kind: 'headings', query: '', target: 'notes/target' }), doc);
assert.deepEqual(formatted.result.ok && 'candidates' in formatted.result.value ? formatted.result.value.candidates.map(value => [value.label, value.anchor]) : null, [['Hello world', 'hello-world'], ['Hello world', 'hello-world-2'], ['Setext', 'setext']]);
assert.equal(decodeEditorServiceResponse({ type: 'editorServiceResult', requestId: 'x', result: { ok: true, value: { candidates: [{ label: 'x', insert: 'x', detail: '', anchor: 42 }] } } }), null);

uris.push(URI.file('D:/workspace/another/target.md'));
const ambiguous = await runEditorService(request({ action: 'links', kind: 'headings', query: '', target: 'target', wiki: true }), doc);
assert.deepEqual(ambiguous.result, { ok: true, value: { candidates: [] } });
const paths = await runEditorService(request({ action: 'links', kind: 'paths', query: 'notes/', target: '' }), doc);
assert.equal(paths.result.ok && 'candidates' in paths.result.value ? paths.result.value.candidates[0].insert : null, 'target.md');
uris = [URI.file('D:/workspace/notes/中文 note.md')];
const encodedTarget = await runEditorService(request({ action: 'links', kind: 'headings', query: 'Setext', target: 'notes/%E4%B8%AD%E6%96%87%20note.md' }), doc);
assert.deepEqual(encodedTarget.result.ok && 'candidates' in encodedTarget.result.value ? encodedTarget.result.value.candidates.map(value => value.anchor) : null, ['setext']);
assert.ok(stats.some(value => value.includes('中文 note')), 'encoded Markdown paths resolve to workspace filenames');
const malformedTarget = await runEditorService(request({ action: 'links', kind: 'headings', query: '', target: '%E4' }), doc);
assert.deepEqual(malformedTarget.result, { ok: true, value: { candidates: [] } });
assert.equal(disposed, created, 'completed lookup disposes its cancellation source');
const posted: any[] = [];
const transport = createEditorServicesTransport(value => posted.push(value));
const pending = transport.request({ action: 'readClipboard' });
assert.equal(transport.accept({ type: 'editorServiceResult', requestId: 'old', result: { ok: true, value: { text: 'old' } } }), false);
assert.equal(transport.accept({ type: 'editorServiceResult', requestId: posted[0].requestId, result: { ok: true, value: { text: 'fresh' } } }), true);
assert.deepEqual(await pending, { text: 'fresh' });
const cancelled = transport.request({ action: 'links', kind: 'documents', query: '', target: '' }); transport.dispose(); assert.equal(await cancelled, null);
assert.equal(await transport.request({ action: 'readClipboard' }), null);
const failing = createEditorServicesTransport(() => { throw new Error('offline'); }); assert.equal(await failing.request({ action: 'readClipboard' }), null); failing.dispose();
console.log('Editor services: bounded codecs, clipboard failures, targeted file lookup, headings/fences/ambiguity, request correlation and disposal passed');

const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
let expire: (() => void) | undefined;
try {
  globalThis.setTimeout = ((callback: () => void) => { expire = callback; return 1; }) as any;
  globalThis.clearTimeout = (() => {}) as any;
  const timed = createEditorServicesTransport(() => {});
  const expired = timed.request({ action: 'readClipboard' }); expire!(); assert.equal(await expired, null); timed.dispose();
} finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
