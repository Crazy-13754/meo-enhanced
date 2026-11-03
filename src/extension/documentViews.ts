import * as vscode from 'vscode';
import type { DocumentViewRegistration, DocumentViewsApi } from '../documentViews';
import type { DocumentViewsChanged } from '../protocol/documentViews';
import { isDocumentViewIconPaths, isDocumentViewIconOffset } from '../protocol/documentViews';
import { decodeReadyMessage } from '../protocol/readyInit';

export function createDocumentViewsRegistry() {
  const views = new Map<string, DocumentViewRegistration & { uri: vscode.Uri; root: vscode.Uri }>();
  const changed = new vscode.EventEmitter<void>();
  const api: DocumentViewsApi = {
    version: 1,
    registerDocumentView(extensionId, view) {
      const extension = vscode.extensions.getExtension(extensionId);
      if (!extension || !/^[a-zA-Z0-9-]+$/.test(view.id) || !view.label?.trim()
        || !/^dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.js$/.test(view.entry)
        || (view.iconPaths !== undefined && !isDocumentViewIconPaths(view.iconPaths))
        || (view.iconOffset !== undefined && !isDocumentViewIconOffset(view.iconOffset))) {
        throw new Error('Invalid document view registration');
      }
      const id = `${extension.id}/${view.id}`;
      if (views.has(id)) throw new Error(`Document view already registered: ${id}`);
      const registration = { ...view, id, uri: vscode.Uri.joinPath(extension.extensionUri, view.entry), root: vscode.Uri.joinPath(extension.extensionUri, 'dist') };
      views.set(id, registration);
      changed.fire();
      return new vscode.Disposable(() => {
        if (views.get(id) !== registration) return;
        views.delete(id);
        changed.fire();
      });
    }
  };
  function attach(panel: vscode.WebviewPanel, ensureInit: () => Promise<void>) {
    const baseRoots = panel.webview.options.localResourceRoots ?? [];
    let ready = false, disposed = false;
    const updateRoots = () => {
      const roots = [...baseRoots, ...[...views.values()].map(v => v.root)];
      const current = panel.webview.options.localResourceRoots ?? [];
      // Updating Webview options can reload its document. Repeated ready/catalog
      // delivery must not reset the editor or an already-open contributed view.
      if (current.length !== roots.length || current.some((uri, index) => uri.toString() !== roots[index].toString())) {
        panel.webview.options = { ...panel.webview.options, localResourceRoots: roots };
      }
    };
    updateRoots();
    const publish = async () => {
      if (!ready || disposed) return;
      await ensureInit();
      if (disposed) return;
      updateRoots();
      const event: DocumentViewsChanged = { type: 'documentViewsChanged', views: [...views.values()].map(v => ({ id: v.id, label: v.label, labelZh: v.labelZh, iconPaths: v.iconPaths, iconOffset: v.iconOffset, entryUri: panel.webview.asWebviewUri(v.uri).toString() })) };
      await panel.webview.postMessage(event);
    };
    const refresh = () => { void publish().catch(error => console.error('Document views could not be delivered', error)); };
    const subscriptions = [changed.event(refresh), panel.webview.onDidReceiveMessage(raw => {
      if (decodeReadyMessage(raw)) { ready = true; refresh(); }
    })];
    const disposal = panel.onDidDispose(() => { disposed = true; subscriptions.forEach(s => s.dispose()); disposal.dispose(); });
  }
  return { api, attach, dispose() { changed.dispose(); views.clear(); } };
}
