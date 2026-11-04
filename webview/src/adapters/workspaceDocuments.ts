import type { DocumentViewWorkspace } from '../../../src/foundation/workspaceDocument';
import type { WorkspaceDocumentsOperation, WorkspaceDocumentsRequest, WorkspaceDocumentsClose, WorkspaceDocumentsResponse, WorkspaceDocumentsChanged, DocumentOperationRequest, DocumentOperationResponse } from '../../../src/protocol/workspaceDocuments';
import type { WorkspaceDocumentsValue } from '../../../src/foundation/workspaceDocument';

/** One request scope per mounted view; close rejects callers and stops native watchers. */
export function createWorkspaceDocumentsTransport(post: (message: WorkspaceDocumentsRequest | WorkspaceDocumentsClose) => void) {
  let sequence = 0;
  const scopes = new Map<string, { listeners: Set<(uri?: string) => void>; close(): void }>();
  const pending = new Map<string, { sessionId: string; resolve(value: WorkspaceDocumentsValue): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  return {
    open(viewId: string): DocumentViewWorkspace & { dispose(): void } {
      const sessionId = `workspace-${Date.now()}-${++sequence}`;
      const listeners = new Set<(uri?: string) => void>();
      let closed = false;
      const request = (operation: WorkspaceDocumentsOperation): Promise<WorkspaceDocumentsValue> => {
        if (closed) return Promise.reject(new Error('Document view closed'));
        const requestId = `${sessionId}-${++sequence}`;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Document request timed out / 文档请求超时')); }, 30_000);
          pending.set(requestId, { sessionId, resolve, reject, timer });
          post({ type: 'workspaceDocumentsRequest', requestId, viewId, sessionId, operation });
        });
      };
      const close = () => {
        if (closed) return; closed = true; scopes.delete(sessionId); listeners.clear();
        for (const [id, item] of pending) if (item.sessionId === sessionId) { clearTimeout(item.timer); item.reject(new Error('Document view closed')); pending.delete(id); }
        post({ type: 'workspaceDocumentsClose', sessionId });
      };
      scopes.set(sessionId, { listeners, close });
      return {
        async list(scope) { const result = await request({ kind: 'list', scope }); if (result.kind !== 'catalog') throw new Error('Invalid document catalog'); return result; },
        async read(uri) { const result = await request({ kind: 'read', uri }); if (result.kind !== 'document') throw new Error('Invalid document snapshot'); return result.document; },
        async edit(edit) { await request({ kind: 'edit', edit }); },
        async reveal(uri, line) { await request({ kind: 'reveal', uri, line }); },
        onDidChange(listener) { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
        dispose: close
      };
    },
    accept(message: WorkspaceDocumentsResponse | WorkspaceDocumentsChanged) {
      if (message.type === 'workspaceDocumentsChanged') { for (const listener of scopes.get(message.sessionId)?.listeners ?? []) listener(message.uri); return; }
      const item = pending.get(message.requestId); if (!item) return;
      pending.delete(message.requestId); clearTimeout(item.timer);
      if (message.result.ok) item.resolve(message.result.value); else item.reject(new Error(message.result.error.message));
    },
    dispose() { for (const scope of [...scopes.values()]) scope.close(); }
  };
}

export function createDocumentOperationResponder(dependencies: {
  post(message: DocumentOperationResponse): void;
  idle(): Promise<void>;
  read(): string;
  edit(operation: Extract<DocumentOperationRequest['operation'], { kind: 'edit' }>): void;
  reveal(line: number): Promise<void>;
}) {
  let disposed = false, queue = Promise.resolve();
  const completed = new Map<string, Promise<DocumentOperationResponse>>();
  return {
    accept(request: DocumentOperationRequest) {
      let result = completed.get(request.requestId);
      if (!result) {
        result = queue.then(async (): Promise<DocumentOperationResponse> => {
          try {
            await dependencies.idle();
            if (disposed) throw new Error('Editor closed');
            if (request.operation.kind === 'edit') dependencies.edit(request.operation);
            if (request.operation.kind === 'reveal') await dependencies.reveal(request.operation.line);
            const text = request.operation.kind === 'read' ? dependencies.read() : ''; await dependencies.idle();
            if (disposed) throw new Error('Editor closed');
            return { type: 'documentOperationResult', requestId: request.requestId, result: { ok: true, value: { text } } };
          } catch (error) { return { type: 'documentOperationResult', requestId: request.requestId, result: { ok: false, error: { code: 'operation-failed', message: error instanceof Error ? error.message : String(error) } } }; }
        });
        completed.set(request.requestId, result); queue = result.then(() => {});
        // Read responses may contain a large draft. Only mutations need replay receipts.
        if (request.operation.kind === 'read') void result.then(() => { if (completed.get(request.requestId) === result) completed.delete(request.requestId); });
        while (completed.size > 128) completed.delete(completed.keys().next().value!);
      }
      void result.then(response => { if (!disposed) dependencies.post(response); });
    },
    dispose() { disposed = true; completed.clear(); }
  };
}
