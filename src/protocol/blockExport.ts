import { decodeDocumentViewsChanged, type DocumentViewDescriptor } from './documentViews';
import { decodeRequestResult, type RequestResult } from './requestResult';

/** Wire DTO; the public extension contract remains standalone and copyable. */
export interface ExportBlockArtifact { readonly kind: 'svg' | 'png'; readonly data: string; readonly width: number; readonly height: number }

export interface ExportBlock { readonly id: string; readonly language: string; readonly text: string }
export interface BlockExportPayload {
  readonly blocks: readonly ExportBlock[];
  readonly renderers: readonly DocumentViewDescriptor[];
  readonly styles: string;
  readonly target: 'html' | 'pdf' | 'docx';
  readonly language: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string;
  readonly codeFontFamily: string;
}
export type BlockExportResult = { readonly id: string } &
  ({ readonly artifact: ExportBlockArtifact } | { readonly error: string });
export type BlockExportRequest = { readonly type: 'requestBlockExport'; readonly requestId: string; readonly payload: BlockExportPayload }
  | { readonly type: 'cancelBlockExport'; readonly requestId: string };
export type BlockExportResponse = { readonly type: 'blockExportResult'; readonly requestId: string; readonly result: RequestResult<readonly BlockExportResult[]> };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
export function isBlockExportArtifact(v: unknown): v is ExportBlockArtifact {
  return record(v) && (v.kind === 'svg' || v.kind === 'png') && typeof v.data === 'string' && v.data.length > 0 && v.data.length <= 16_000_000
    && [v.width, v.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000)
    && (v.kind !== 'png' || /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.data));
}
export function decodeBlockExportRequest(v: unknown): BlockExportRequest | null {
  if (!record(v) || !id(v.requestId)) return null;
  if (v.type === 'cancelBlockExport') return { type: v.type, requestId: v.requestId };
  const p = v.payload;
  if (v.type !== 'requestBlockExport' || !record(p) || !Array.isArray(p.blocks) || p.blocks.length > 1000
    || !p.blocks.every(b => record(b) && id(b.id) && typeof b.language === 'string' && typeof b.text === 'string')
    || new Set(p.blocks.map(b => b.id)).size !== p.blocks.length
    || !['html', 'pdf', 'docx'].includes(String(p.target)) || typeof p.styles !== 'string'
    || !['language', 'fontFamily', 'fontWeight', 'codeFontFamily'].every(k => typeof p[k] === 'string')
    || typeof p.fontSize !== 'number' || !Number.isFinite(p.fontSize) || p.fontSize <= 0) return null;
  const catalog = decodeDocumentViewsChanged({ type: 'documentViewsChanged', views: p.renderers });
  return catalog ? { type: v.type, requestId: v.requestId, payload: { ...p, renderers: catalog.views } as unknown as BlockExportPayload } : null;
}
export function decodeBlockExportResponse(v: unknown): BlockExportResponse | null {
  if (!record(v) || v.type !== 'blockExportResult' || !id(v.requestId)) return null;
  const result = decodeRequestResult(v.result, items => {
    if (!Array.isArray(items) || items.length > 1000 || !items.every(item => record(item) && id(item.id)
      && (isBlockExportArtifact(item.artifact) || typeof item.error === 'string' && item.error.length <= 4000))
      || new Set(items.map(item => item.id)).size !== items.length) return null;
    return items as BlockExportResult[];
  });
  return result ? { type: v.type, requestId: v.requestId, result } : null;
}
