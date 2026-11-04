import assert from 'node:assert/strict';
import { FixtureEvent, installWorkspaceFixture } from './workspace-documents-fixture';
import { readMarkdownListItems } from '../src/shared/markdownListItems';
const a = 'file:///workspace/a.md', b = 'file:///workspace/b.md';
const fixture = installWorkspaceFixture({ [a]: '# A\n- [ ] current', [b]: '# B\r\n\r\n- [ ] target\r\n' });
const { createWorkspaceDocumentsHost } = await import('../src/host/workspaceDocuments');
const incoming = new FixtureEvent<unknown>(), closed = new FixtureEvent<void>(), replies = new Map<string, any>();
let enabled = true, editCalls = 0, draft = fixture.documents.get(a)!.text;
const owner = createWorkspaceDocumentsHost({ parseLists: async text => readMarkdownListItems(text), open: async () => {} });
const panel: any = { reveal() {}, onDidDispose: closed.event, webview: { onDidReceiveMessage: incoming.event, async postMessage(message: any) {
  if (message.type === 'documentOperationRequest') {
    const o = message.operation; if (o.kind === 'edit') { assert.equal(o.text, draft); draft = draft.slice(0, o.from) + o.insert + draft.slice(o.from + o.expected.length); editCalls++; }
    incoming.fire({ type: 'documentOperationResult', requestId: message.requestId, result: { ok: true, value: { text: draft } } });
  } else if (message.type === 'workspaceDocumentsResult') replies.set(message.requestId, message.result);
  return true;
} } };
const connection = owner.attach(panel, fixture.documents.get(a)! as any, async () => {}, () => enabled);
let counter = 0;
async function request(operation: any, id = `r${++counter}`) { incoming.fire({ type: 'workspaceDocumentsRequest', requestId: id, viewId: 'tasks', sessionId: 's', operation }); for (let i = 0; i < 100 && !replies.has(id); i++) await new Promise(r => setTimeout(r, 1)); assert(replies.has(id)); return replies.get(id); }
assert.equal((await request({ kind: 'read', uri: b })).ok, false, 'Unlisted files cannot be read');
await request({ kind: 'list', scope: 'workspace' });
const first = (await request({ kind: 'read', uri: b })).value.document;
fixture.change(b, '# moved\r\n' + fixture.documents.get(b)!.text);
assert.equal((await request({ kind: 'edit', edit: { uri: b, version: first.version, from: first.items[0].task.from, expected: ' ', insert: 'x' } })).ok, false);
const latest = (await request({ kind: 'read', uri: b })).value.document;
assert.equal((await request({ kind: 'edit', edit: { uri: b, version: latest.version, from: latest.items[0].task.from, expected: ' ', insert: 'x' } }, 'native-edit')).ok, true);
await request({ kind: 'edit', edit: { uri: b, version: latest.version, from: latest.items[0].task.from, expected: ' ', insert: 'x' } }, 'native-edit');
assert.equal(fixture.counts().nativeEdits, 1); assert(fixture.documents.get(b)!.text.endsWith('- [x] target\r\n'));
draft = '# A\n- [ ] unsaved draft';
const active = (await request({ kind: 'read', uri: a })).value.document;
assert.equal(active.items[0].text, 'unsaved draft');
await request({ kind: 'edit', edit: { uri: a, version: active.version, from: active.items[0].task.from, expected: ' ', insert: 'x' } });
assert.equal(editCalls, 1); assert.equal(fixture.counts().nativeEdits, 1, 'Open MEO edits go through the editor history');
enabled = false; connection.refresh(); assert.equal(fixture.counts().watchers, 0);
closed.fire(); owner.dispose(); assert.equal(incoming.listeners.size, 0);
console.log('Workspace host: scoped files, stale edits, unsaved drafts, CRLF, native/editor routing, duplicate requests and feature disposal passed');
