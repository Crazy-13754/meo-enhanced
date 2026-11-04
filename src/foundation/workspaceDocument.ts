/** Read-only Markdown list structure; positions refer to LF-normalized source. */
export interface MarkdownListItem {
  readonly line: number;
  readonly text: string;
  readonly heading: string;
  readonly task?: { readonly from: number; readonly marker: ' ' | 'x' | 'X' };
}
export interface WorkspaceDocumentInfo { readonly uri: string; readonly label: string }
export interface WorkspaceDocumentSnapshot extends WorkspaceDocumentInfo {
  /** Opaque content identity, never a view render counter. */
  readonly version: string;
  readonly items: readonly MarkdownListItem[];
}
export interface WorkspaceDocumentEdit {
  readonly uri: string;
  readonly version: string;
  readonly from: number;
  readonly expected: string;
  readonly insert: string;
}
export type WorkspaceDocumentsValue =
  | { readonly kind: 'catalog'; readonly current: string; readonly documents: readonly WorkspaceDocumentInfo[]; readonly complete: boolean; readonly workspace: boolean }
  | { readonly kind: 'document'; readonly document: WorkspaceDocumentSnapshot }
  | { readonly kind: 'done' };

export interface DocumentViewWorkspace {
  list(scope: 'current' | 'workspace'): Promise<{ current: string; documents: readonly WorkspaceDocumentInfo[]; complete: boolean; workspace: boolean }>;
  read(uri: string): Promise<WorkspaceDocumentSnapshot>;
  edit(edit: WorkspaceDocumentEdit): Promise<void>;
  reveal(uri: string, line: number): Promise<void>;
  onDidChange(listener: (uri?: string) => void): { dispose(): void };
}
