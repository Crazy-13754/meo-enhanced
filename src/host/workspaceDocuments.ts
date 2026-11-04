import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { normalizeDocumentText } from '../foundation/documentText';
import type { MarkdownListItem, WorkspaceDocumentsValue } from '../foundation/workspaceDocument';
import { decodeWorkspaceDocumentsRequest, decodeDocumentOperationResponse, type DocumentOperation, type DocumentOperationResponse, type WorkspaceDocumentsRequest } from '../protocol/workspaceDocuments';

const MAX_FILES = 10_000, MAX_BYTES = 8 * 1024 * 1024;
const version = (text: string) => createHash('sha256').update(text).digest('hex');
const stale = () => new Error('The document changed; refresh and retry. / 文档已变化，请刷新后重试。');
type Connection = { panel: vscode.WebviewPanel; document: vscode.TextDocument; request(operation: DocumentOperation): Promise<string>; refresh(): void; dispose(): void };

/** Native document access shared by contributed views. Feature indexes stay in their modules. */
export function createWorkspaceDocumentsHost(dependencies: {
  parseLists(text: string): Promise<readonly MarkdownListItem[]>;
  open(uri: vscode.Uri, line: number): Promise<void>;
}) {
  const connections = new Map<string, Connection>();
  const cache = new Map<string, { version: string; items: readonly MarkdownListItem[] }>();
  let sequence = 0;
  const label = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, true);
  async function textOf(uri: vscode.Uri): Promise<string> {
    const connection = connections.get(uri.toString());
    if (connection) return normalizeDocumentText(await connection.request({ kind: 'read' }));
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open) return normalizeDocumentText(open.getText());
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_BYTES) throw new Error('Document exceeds the 8 MiB indexing limit. / 文档超过 8 MiB 索引上限。');
    return normalizeDocumentText(new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri)));
  }
  function attach(panel: vscode.WebviewPanel, document: vscode.TextDocument, ready: () => Promise<void>, allowedView: (id: string) => boolean) {
    let disposed = false;
    const pending = new Map<string, { resolve(text: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    const scopes = new Map<string, { viewId: string; allowed: Set<string>; subscriptions: vscode.Disposable[]; cancellation: vscode.CancellationTokenSource }>();
    const completed = new Map<string, Promise<WorkspaceDocumentsValue>>();
    const connection: Connection = { panel, document, async request(operation) {
      await ready();
      if (disposed) throw new Error('Editor closed / 编辑器已关闭');
      const requestId = `document-operation-${++sequence}`;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Document operation timed out / 文档操作超时')); }, 20_000);
        pending.set(requestId, { resolve, reject, timer });
        void panel.webview.postMessage({ type: 'documentOperationRequest', requestId, operation }).then(posted => {
          if (!posted) { const p = pending.get(requestId); pending.delete(requestId); if (p) { clearTimeout(p.timer); p.reject(new Error('Editor unavailable / 编辑器不可用')); } }
        });
      });
    }, refresh() { for (const [id, scope] of scopes) if (!allowedView(scope.viewId)) close(id); }, dispose() {
      if (disposed) return; disposed = true;
      for (const id of [...scopes.keys()]) close(id);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Editor closed / 编辑器已关闭')); }
      pending.clear(); completed.clear(); receive.dispose(); disposal.dispose();
      if (connections.get(document.uri.toString()) === connection) connections.delete(document.uri.toString());
      if (!connections.size) cache.clear();
    } };
    connections.set(document.uri.toString(), connection);
    function close(id: string) {
      const scope = scopes.get(id); if (!scope) return;
      scopes.delete(id); scope.cancellation.cancel(); scope.cancellation.dispose(); scope.subscriptions.forEach(s => s.dispose()); cache.clear();
      completed.clear();
    }
    function scopeFor(request: WorkspaceDocumentsRequest) {
      if (!allowedView(request.viewId)) throw new Error('Document view is disabled / 文档视图已关闭');
      let scope = scopes.get(request.sessionId);
      if (scope && scope.viewId !== request.viewId) throw new Error('Invalid view session');
      if (!scope) {
        // Only one contributed whole-document view can be mounted in a panel.
        for (const id of [...scopes.keys()]) close(id);
        scope = { viewId: request.viewId, allowed: new Set([document.uri.toString()]), subscriptions: [], cancellation: new vscode.CancellationTokenSource() };
        scopes.set(request.sessionId, scope);
        const current = scope;
        const changed = (uri?: vscode.Uri) => {
          if (disposed || scopes.get(request.sessionId) !== current) return;
          if (!allowedView(request.viewId)) { close(request.sessionId); return; }
          void panel.webview.postMessage({ type: 'workspaceDocumentsChanged', sessionId: request.sessionId,
            ...(uri && current.allowed.has(uri.toString()) ? { uri: uri.toString() } : {}) });
        };
        current.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => { if (e.contentChanges.length && current.allowed.has(e.document.uri.toString())) changed(e.document.uri); }),
          vscode.workspace.onDidChangeWorkspaceFolders(() => { changed(); close(request.sessionId); }),
          vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('search.exclude')) changed(); }));
        for (const root of vscode.workspace.workspaceFolders ?? []) {
          const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*.{md,markdown,mdx,mdc}'));
          current.subscriptions.push(watcher, watcher.onDidChange(uri => changed(uri)), watcher.onDidCreate(() => changed()), watcher.onDidDelete(() => changed()));
        }
      }
      return scope;
    }
    async function run(request: WorkspaceDocumentsRequest): Promise<WorkspaceDocumentsValue> {
      const scope = scopeFor(request), operation = request.operation;
      const live = () => { if (disposed || scopes.get(request.sessionId) !== scope || !allowedView(request.viewId)) throw new Error('Document view closed / 文档视图已关闭'); };
      if (operation.kind === 'list') {
        const roots = vscode.workspace.workspaceFolders ?? [];
        const files = new Map([[document.uri.toString(), document.uri]]);
        let complete = true;
        if (operation.scope === 'workspace') {
          for (const root of roots) {
            live();
            const exclude = { ...vscode.workspace.getConfiguration('files', root.uri).get<Record<string, boolean>>('exclude', {}),
              ...vscode.workspace.getConfiguration('search', root.uri).get<Record<string, boolean>>('exclude', {}) };
            const patterns = ['**/{.git,node_modules,dist,.cache,.obsidian}/**', ...Object.entries(exclude).filter(([, v]) => v === true).map(([k]) => k)];
            const found = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.{md,markdown,mdx,mdc}'), `{${patterns.join(',')}}`, MAX_FILES + 1, scope.cancellation.token);
            live();
            for (const uri of found) { if (files.size >= MAX_FILES && !files.has(uri.toString())) { complete = false; break; } files.set(uri.toString(), uri); }
          }
        }
        scope.allowed = new Set(files.keys());
        return { kind: 'catalog', current: document.uri.toString(), workspace: roots.length > 0, complete,
          documents: [...files.values()].map(uri => ({ uri: uri.toString(), label: label(uri) })).sort((a, b) => a.label.localeCompare(b.label)) };
      }
      const key = operation.kind === 'edit' ? operation.edit.uri : operation.uri;
      if (!scope.allowed.has(key)) throw new Error('Document is outside this view scope / 文档不在当前视图范围内');
      const uri = vscode.Uri.parse(key);
      if (operation.kind === 'reveal') { await dependencies.open(uri, operation.line); live(); return { kind: 'done' }; }
      const text = await textOf(uri); live();
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Document exceeds the 8 MiB indexing limit. / 文档超过 8 MiB 索引上限。');
      const identity = version(text);
      if (operation.kind === 'read') {
        let entry = cache.get(key);
        if (!entry || entry.version !== identity) {
          entry = { version: identity, items: await dependencies.parseLists(text) }; live();
          cache.delete(key); cache.set(key, entry);
          while (cache.size > 32) cache.delete(cache.keys().next().value!);
        }
        return { kind: 'document', document: { uri: key, label: label(uri), version: identity, items: entry.items } };
      }
      const edit = operation.edit;
      if (identity !== edit.version || edit.from + edit.expected.length > text.length || text.slice(edit.from, edit.from + edit.expected.length) !== edit.expected) throw stale();
      const target = connections.get(key);
      if (target) {
        await target.request({ kind: 'edit', text, from: edit.from, expected: edit.expected, insert: edit.insert });
      } else {
        const targetDocument = await vscode.workspace.openTextDocument(uri); live();
        // The document may have opened in MEO while its TextDocument was loading.
        const opened = connections.get(key);
        if (opened) await opened.request({ kind: 'edit', text, from: edit.from, expected: edit.expected, insert: edit.insert });
        else {
          const raw = targetDocument.getText();
          if (normalizeDocumentText(raw) !== text) throw stale();
          const rawOffset = (offset: number) => { let at = 0, normalized = 0; while (normalized < offset && at < raw.length) { if (raw[at] === '\r' && raw[at + 1] === '\n') at++; at++; normalized++; } return at; };
          const change = new vscode.WorkspaceEdit();
          change.replace(uri, new vscode.Range(targetDocument.positionAt(rawOffset(edit.from)), targetDocument.positionAt(rawOffset(edit.from + edit.expected.length))), edit.insert);
          if (!await vscode.workspace.applyEdit(change)) throw new Error('Edit was rejected / 编辑未能完成');
        }
      }
      cache.delete(key);
      return { kind: 'done' };
    }
    const receive = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const reply: DocumentOperationResponse | null = decodeDocumentOperationResponse(raw);
      if (reply) {
        const p = pending.get(reply.requestId); if (!p) return;
        pending.delete(reply.requestId); clearTimeout(p.timer);
        if (reply.result.ok) p.resolve(reply.result.value.text); else p.reject(new Error(reply.result.error.message));
        return;
      }
      const request = decodeWorkspaceDocumentsRequest(raw); if (!request) return;
      if (request.type === 'workspaceDocumentsClose') { close(request.sessionId); return; }
      let result = completed.get(request.requestId);
      if (!result) {
        result = run(request); completed.set(request.requestId, result);
        if (request.operation.kind !== 'edit') {
          const forget = () => { if (completed.get(request.requestId) === result) completed.delete(request.requestId); };
          void result.then(forget, forget);
        }
        while (completed.size > 128) completed.delete(completed.keys().next().value!);
      }
      void result.then(value => panel.webview.postMessage({ type: 'workspaceDocumentsResult', requestId: request.requestId, result: { ok: true, value } }),
        error => panel.webview.postMessage({ type: 'workspaceDocumentsResult', requestId: request.requestId, result: { ok: false, error: { code: 'operation-failed', message: error instanceof Error ? error.message : String(error) } } }));
    });
    const disposal = panel.onDidDispose(connection.dispose);
    return connection;
  }
  return { attach, async reveal(uri: vscode.Uri, line: number) {
    const target = connections.get(uri.toString());
    if (!target) return false;
    target.panel.reveal(undefined, true); await target.request({ kind: 'reveal', line }); return true;
  }, dispose() { for (const connection of [...connections.values()]) connection.dispose(); cache.clear(); } };
}
