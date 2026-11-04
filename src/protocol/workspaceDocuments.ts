import type { WorkspaceDocumentEdit, WorkspaceDocumentsValue, MarkdownListItem } from '../foundation/workspaceDocument';
import { decodeRequestResult, type RequestResult } from './requestResult';

export type WorkspaceDocumentsOperation =
  | { readonly kind: 'list'; readonly scope: 'current' | 'workspace' }
  | { readonly kind: 'read'; readonly uri: string }
  | { readonly kind: 'edit'; readonly edit: WorkspaceDocumentEdit }
  | { readonly kind: 'reveal'; readonly uri: string; readonly line: number };
export type WorkspaceDocumentsRequest = { readonly type: 'workspaceDocumentsRequest'; readonly requestId: string; readonly viewId: string; readonly sessionId: string; readonly operation: WorkspaceDocumentsOperation };
export type WorkspaceDocumentsClose = { readonly type: 'workspaceDocumentsClose'; readonly sessionId: string };
export type WorkspaceDocumentsResponse = { readonly type: 'workspaceDocumentsResult'; readonly requestId: string; readonly result: RequestResult<WorkspaceDocumentsValue> };
export type WorkspaceDocumentsChanged = { readonly type: 'workspaceDocumentsChanged'; readonly sessionId: string; readonly uri?: string };
export type DocumentOperation = { readonly kind: 'read' } | { readonly kind: 'edit'; readonly text: string; readonly from: number; readonly expected: string; readonly insert: string } | { readonly kind: 'reveal'; readonly line: number };
export type DocumentOperationRequest = { readonly type: 'documentOperationRequest'; readonly requestId: string; readonly operation: DocumentOperation };
export type DocumentOperationResponse = { readonly type: 'documentOperationResult'; readonly requestId: string; readonly result: RequestResult<{ text: string }> };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string';
const id = (v: unknown): v is string => string(v) && v.length > 0 && v.length <= 4096;
const offset = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const line = (v: unknown): v is number => offset(v) && v > 0;
function edit(v: unknown): WorkspaceDocumentEdit | null {
  return record(v) && id(v.uri) && string(v.version) && /^[a-f0-9]{64}$/.test(v.version) && offset(v.from)
    && string(v.expected) && v.expected.length <= 65536 && string(v.insert) && v.insert.length <= 65536
    ? { uri: v.uri, version: v.version, from: v.from, expected: v.expected, insert: v.insert } : null;
}
export function decodeWorkspaceDocumentsRequest(v: unknown): WorkspaceDocumentsRequest | WorkspaceDocumentsClose | null {
  if (!record(v) || !id(v.sessionId)) return null;
  if (v.type === 'workspaceDocumentsClose') return { type: v.type, sessionId: v.sessionId };
  if (v.type !== 'workspaceDocumentsRequest' || !id(v.requestId) || !id(v.viewId) || !record(v.operation)) return null;
  const o = v.operation; let operation: WorkspaceDocumentsOperation | null = null;
  if (o.kind === 'list' && (o.scope === 'current' || o.scope === 'workspace')) operation = { kind: o.kind, scope: o.scope };
  if (o.kind === 'read' && id(o.uri)) operation = { kind: o.kind, uri: o.uri };
  if (o.kind === 'reveal' && id(o.uri) && line(o.line)) operation = { kind: o.kind, uri: o.uri, line: o.line };
  const e = o.kind === 'edit' ? edit(o.edit) : null;
  if (e) operation = { kind: 'edit', edit: e };
  return operation ? { type: v.type, requestId: v.requestId, viewId: v.viewId, sessionId: v.sessionId, operation } : null;
}
function listItem(v: unknown): MarkdownListItem | null {
  if (!record(v) || !line(v.line) || !string(v.text) || !string(v.heading)) return null;
  if (v.task !== undefined && (!record(v.task) || !offset(v.task.from) || ![' ','x','X'].includes(v.task.marker as string))) return null;
  return { line: v.line, text: v.text, heading: v.heading, ...(record(v.task) ? { task: { from: v.task.from as number, marker: v.task.marker as ' ' | 'x' | 'X' } } : {}) };
}
export function decodeWorkspaceDocumentsResponse(v: unknown): WorkspaceDocumentsResponse | WorkspaceDocumentsChanged | null {
  if (!record(v)) return null;
  if (v.type === 'workspaceDocumentsChanged' && id(v.sessionId) && (v.uri === undefined || id(v.uri))) return { type: v.type, sessionId: v.sessionId, ...(v.uri ? { uri: v.uri as string } : {}) };
  if (v.type !== 'workspaceDocumentsResult' || !id(v.requestId)) return null;
  const result = decodeRequestResult<WorkspaceDocumentsValue>(v.result, data => {
    if (!record(data)) return null;
    if (data.kind === 'done') return { kind: data.kind };
    if (data.kind === 'catalog' && id(data.current) && typeof data.complete === 'boolean' && typeof data.workspace === 'boolean' && Array.isArray(data.documents)
      && data.documents.every(d => record(d) && id(d.uri) && string(d.label))) return { kind: data.kind, current: data.current, complete: data.complete, workspace: data.workspace, documents: data.documents.map(d => ({ uri: d.uri as string, label: d.label as string })) };
    if (data.kind !== 'document' || !record(data.document)) return null;
    const d = data.document;
    if (!id(d.uri) || !string(d.label) || !string(d.version) || !/^[a-f0-9]{64}$/.test(d.version) || !Array.isArray(d.items)) return null;
    const items = d.items.map(listItem);
    if (items.some(i => !i)) return null;
    return { kind: data.kind, document: { uri: d.uri, label: d.label, version: d.version, items: items as MarkdownListItem[] } };
  });
  return result ? { type: v.type, requestId: v.requestId, result } : null;
}
export function decodeDocumentOperationRequest(v: unknown): DocumentOperationRequest | null {
  if (!record(v) || v.type !== 'documentOperationRequest' || !id(v.requestId) || !record(v.operation)) return null;
  const o = v.operation; let operation: DocumentOperation | null = null;
  if (o.kind === 'read') operation = { kind: o.kind };
  if (o.kind === 'reveal' && line(o.line)) operation = { kind: o.kind, line: o.line };
  if (o.kind === 'edit' && string(o.text) && offset(o.from) && string(o.expected) && string(o.insert) && o.expected.length <= 65536 && o.insert.length <= 65536)
    operation = { kind: o.kind, text: o.text, from: o.from, expected: o.expected, insert: o.insert };
  return operation ? { type: v.type, requestId: v.requestId, operation } : null;
}
export function decodeDocumentOperationResponse(v: unknown): DocumentOperationResponse | null {
  if (!record(v) || v.type !== 'documentOperationResult' || !id(v.requestId)) return null;
  const result = decodeRequestResult(v.result, data => record(data) && string(data.text) ? { text: data.text } : null);
  return result ? { type: v.type, requestId: v.requestId, result } : null;
}
