import { mock } from 'bun:test';
export class FixtureEvent<T> {
  listeners = new Set<(value: T) => void>();
  event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value: T) { for (const listener of this.listeners) listener(value); }
}
export function installWorkspaceFixture(contents: Record<string, string>) {
  class Uri { constructor(readonly value: string) {} toString() { return this.value; } get path() { return new URL(this.value).pathname; } static parse(value: string) { return new Uri(value); } }
  class Position { constructor(readonly line: number, readonly character: number) {} }
  class Range { constructor(readonly start: Position, readonly end: Position) {} }
  class WorkspaceEdit { changes: { uri: Uri; range: Range; text: string }[] = []; replace(uri: Uri, range: Range, text: string) { this.changes.push({ uri, range, text }); } }
  class CancellationTokenSource {
    private cancellation = { isCancellationRequested: false };
    get token() { return this.cancellation; }
    cancel() { this.cancellation.isCancellationRequested = true; }
    dispose() {}
  }
  class Document {
    uri: Uri; version = 1; isDirty = false;
    constructor(uri: string, public text: string) { this.uri = new Uri(uri); }
    getText() { return this.text; }
    positionAt(offset: number) { const lines = this.text.slice(0, offset).split('\n'); return new Position(lines.length - 1, lines.at(-1)!.length); }
    offsetAt(position: Position) { return this.text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character; }
  }
  const documents = new Map(Object.entries(contents).map(([uri, text]) => [uri, new Document(uri, text)]));
  const changed = new FixtureEvent<any>(), rootsChanged = new FixtureEvent<void>(), configChanged = new FixtureEvent<any>();
  const watcherChanges = new FixtureEvent<any>(), creates = new FixtureEvent<any>(), deletes = new FixtureEvent<any>();
  const open = new Set<string>(); let watchers = 0, nativeEdits = 0;
  function change(uri: string, text: string) { const d = documents.get(uri)!; d.text = text; d.version++; d.isDirty = true; changed.fire({ document: d, contentChanges: [{ text }] }); }
  const vscode = {
    Uri, Position, Range, WorkspaceEdit, CancellationTokenSource, RelativePattern: class { constructor(public base: unknown, public pattern: string) {} },
    workspace: {
      workspaceFolders: [{ uri: new Uri('file:///workspace'), name: 'workspace' }],
      get textDocuments() { return [...open].map(uri => documents.get(uri)!); },
      asRelativePath(uri: Uri) { return uri.path.replace('/workspace/', ''); },
      getConfiguration() { return { get: (_key: string, fallback: unknown) => fallback }; },
      findFiles: async () => [...documents.values()].map(d => d.uri),
      openTextDocument: async (uri: Uri) => { const d = documents.get(uri.toString()); if (!d) throw new Error('missing'); open.add(uri.toString()); return d; },
      fs: { stat: async (uri: Uri) => ({ size: documents.get(uri.toString())!.text.length }), readFile: async (uri: Uri) => new TextEncoder().encode(documents.get(uri.toString())!.text) },
      onDidChangeTextDocument: changed.event, onDidChangeWorkspaceFolders: rootsChanged.event, onDidChangeConfiguration: configChanged.event,
      createFileSystemWatcher() { watchers++; return { onDidChange: watcherChanges.event, onDidCreate: creates.event, onDidDelete: deletes.event, dispose() { watchers--; } }; },
      applyEdit: async (edit: WorkspaceEdit) => { nativeEdits++; for (const e of edit.changes) { const d = documents.get(e.uri.toString())!; change(e.uri.toString(), d.text.slice(0, d.offsetAt(e.range.start)) + e.text + d.text.slice(d.offsetAt(e.range.end))); } return true; }
    }
  };
  mock.module('vscode', () => vscode);
  return { vscode, documents, open, change, changed, creates, deletes, watcherChanges, rootsChanged, counts: () => ({ watchers, nativeEdits }) };
}
