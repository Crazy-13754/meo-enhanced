import assert from 'node:assert/strict';
import { readMarkdownListItems } from '../src/shared/markdownListItems';
import { decodeWebviewToHostMessage, decodeHostToWebviewMessage } from '../src/protocol/messages';
import { createDocumentOperationResponder, createWorkspaceDocumentsTransport } from '../webview/src/adapters/workspaceDocuments';

const text = ['---','tasks: "- [ ] metadata"','---','# Project','','- [ ] first **task**','  - [X] child','> 1. [ ] quoted','- [ ] repeated [ ] repeated','','```md','- [ ] example','```','','    - [ ] code','','<div>','- [ ] HTML','</div>'].join('\n');
const items = readMarkdownListItems(text).filter(i => i.task);
assert.deepEqual(items.map(i => [i.text, i.task!.marker]), [['first task',' '],['child','X'],['quoted',' '],['repeated [ ] repeated',' ']]);
for (const item of items) { assert.equal(text[item.task!.from], item.task!.marker); assert.equal(text[item.task!.from - 1], '['); assert.equal(item.heading, 'Project'); }
assert.deepEqual(readMarkdownListItems(text.replaceAll('\n', '\r\n')), readMarkdownListItems(text));
const large = '# Large\n' + 'ordinary paragraph\n\n'.repeat(40000) + '- [ ] offscreen\n';
assert.equal(readMarkdownListItems(large).filter(i => i.task).at(-1)?.text, 'offscreen');
const request = { type: 'workspaceDocumentsRequest', requestId: 'r', viewId: 'extras/tasks', sessionId: 's', operation: { kind: 'edit', edit: { uri: 'file:///a.md', version: 'a'.repeat(64), from: 3, expected: ' ', insert: 'x' } } };
assert.deepEqual(decodeWebviewToHostMessage(request), request);
for (const bad of [-1, Infinity, 0.5, '3']) assert.equal(decodeWebviewToHostMessage({ ...request, operation: { kind: 'edit', edit: { ...request.operation.edit, from: bad } } }), null);
assert.equal(decodeWebviewToHostMessage({ ...request, operation: { kind: 'list', scope: 'all-disks' } }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'workspaceDocumentsResult', requestId: 'r', result: { ok: true, value: { kind: 'document', document: { uri: 'a', label: 'a', version: 'b'.repeat(64), items: [{ line: 1, text: '', heading: '', task: { from: -1, marker: ' ' } }] } } } }), null);
const sent: any[] = [];
const transport = createWorkspaceDocumentsTransport(message => sent.push(message));
const scope = transport.open('extras/tasks');
let notified = 0; scope.onDidChange(() => notified++);
const pending = scope.list('current');
const sentRequest = sent[0];
transport.accept({ type: 'workspaceDocumentsChanged', sessionId: sentRequest.sessionId, uri: 'file:///a.md' }); assert.equal(notified, 1);
const cancelled = assert.rejects(pending, /closed/); scope.dispose(); await cancelled;
transport.accept({ type: 'workspaceDocumentsChanged', sessionId: sentRequest.sessionId }); assert.equal(notified, 1);
transport.dispose();
let source = '- [ ] task', edits = 0;
const replies: any[] = [];
const responder = createDocumentOperationResponder({ post: reply => replies.push(reply), idle: async () => {}, read: () => source,
  edit(operation) { if (operation.text !== source) throw new Error('stale'); edits++; source = source.slice(0, operation.from) + operation.insert + source.slice(operation.from + operation.expected.length); }, reveal: async () => {} });
const edit = { type: 'documentOperationRequest', requestId: 'edit-1', operation: { kind: 'edit', text: source, from: 3, expected: ' ', insert: 'x' } } as const;
responder.accept(edit); responder.accept(edit);
await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(edits, 1); assert.equal(source, '- [x] task');
responder.accept({ ...edit, requestId: 'stale' }); await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(replies.at(-1).result.ok, false); assert.equal(edits, 1); responder.dispose();
console.log('Workspace document grammar, exact source ranges, large content, protocol, cancellation and edit idempotency passed');
