export interface DocumentViewDescriptor {
  readonly id: string;
  readonly label: string;
  readonly labelZh?: string;
  readonly iconPaths?: readonly string[];
  readonly iconOffset?: { readonly x: number; readonly y: number };
  readonly entryUri: string;
}
export interface DocumentViewsChanged {
  readonly type: 'documentViewsChanged';
  readonly views: readonly DocumentViewDescriptor[];
}
export function isDocumentViewIconPaths(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16
    && value.every(path => typeof path === 'string' && path.length > 0 && path.length <= 2048
      && /^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]+$/.test(path));
}
export function isDocumentViewIconOffset(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const offset = value as Record<string, unknown>;
  return [offset.x, offset.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1);
}
export function decodeDocumentViewsChanged(value: unknown): DocumentViewsChanged | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'documentViewsChanged' || !Array.isArray(event.views)) return null;
  const ids = new Set<string>();
  const views: DocumentViewDescriptor[] = [];
  for (const raw of event.views) {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    if (typeof v.id !== 'string' || !v.id || ids.has(v.id)
      || typeof v.label !== 'string' || !v.label || typeof v.entryUri !== 'string' || !v.entryUri
      || (v.labelZh !== undefined && typeof v.labelZh !== 'string')
      || (v.iconPaths !== undefined && !isDocumentViewIconPaths(v.iconPaths))
      || (v.iconOffset !== undefined && !isDocumentViewIconOffset(v.iconOffset))) return null;
    ids.add(v.id);
    views.push({ id: v.id, label: v.label, labelZh: v.labelZh as string | undefined, iconPaths: v.iconPaths as readonly string[] | undefined,
      iconOffset: v.iconOffset as DocumentViewDescriptor['iconOffset'], entryUri: v.entryUri });
  }
  return { type: 'documentViewsChanged', views };
}
