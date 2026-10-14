import { decodePreviewFonts, type PreviewFont } from '../foundation/previewFonts';
import { decodeRequestResult, type RequestResult } from './requestResult';

export type PreviewFontsRequest = { readonly type: 'getPreviewFonts'; readonly requestId: string; readonly refresh: boolean };
export type PreviewFontsResponse = { readonly type: 'previewFontsResult'; readonly requestId: string; readonly result: RequestResult<readonly PreviewFont[]> };
const correlated = (value: unknown): value is Record<string, unknown> & { requestId: string } => (
  typeof value === 'object' && value !== null && 'requestId' in value
  && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 200
);
export function decodePreviewFontsRequest(value: unknown): PreviewFontsRequest | null {
  return correlated(value) && value.type === 'getPreviewFonts' && typeof value.refresh === 'boolean'
    ? { type: value.type, requestId: value.requestId, refresh: value.refresh } : null;
}
export function decodePreviewFontsResponse(value: unknown): PreviewFontsResponse | null {
  if (!correlated(value) || value.type !== 'previewFontsResult') return null;
  const result = decodeRequestResult(value.result, decodePreviewFonts);
  return result ? { type: value.type, requestId: value.requestId, result } : null;
}
