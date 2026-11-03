import { decodeRequestResult, type RequestResult } from './requestResult';

/** Ordinary, read-only Markdown. No Preview preset or resource resolution. */
export type DocumentContentValue = { readonly html: string };
export type DocumentContentRequest = { readonly type: 'requestDocumentContent'; readonly requestId: string; readonly text: string };
export type DocumentContentResponse = { readonly type: 'documentContentResult'; readonly requestId: string; readonly result: RequestResult<DocumentContentValue> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
export function decodeDocumentContentRequest(value: unknown): DocumentContentRequest | null {
  return record(value) && value.type === 'requestDocumentContent' && typeof value.requestId === 'string' && !!value.requestId
    && typeof value.text === 'string' ? { type: value.type, requestId: value.requestId, text: value.text } : null;
}
export function decodeDocumentContentResponse(value: unknown): DocumentContentResponse | null {
  if (!record(value) || value.type !== 'documentContentResult' || typeof value.requestId !== 'string' || !value.requestId) return null;
  const result = decodeRequestResult(value.result, v => record(v) && typeof v.html === 'string' ? { html: v.html } : null);
  return result ? { type: value.type, requestId: value.requestId, result } : null;
}
