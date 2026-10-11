import { decodeUiColors, type UiColors } from '../foundation/uiColors';
import { decodeRequestResult, type RequestResult } from './requestResult';

export const UI_COLORS_TIMEOUT_MS = 15000;
export type UpdateUiColorsRequest = { readonly type: 'updateUiColors'; readonly requestId: string; readonly colors: UiColors };
export type UiColorsResult = { readonly type: 'uiColorsResult'; readonly requestId: string; readonly result: RequestResult<UiColors> };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const requestId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

export function decodeUpdateUiColorsRequest(value: unknown): UpdateUiColorsRequest | null {
  if (!record(value) || value.type !== 'updateUiColors' || !requestId(value.requestId)) return null;
  const colors = decodeUiColors(value.colors);
  return colors ? { type: value.type, requestId: value.requestId, colors } : null;
}

export function decodeUiColorsResult(value: unknown): UiColorsResult | null {
  if (!record(value) || value.type !== 'uiColorsResult' || !requestId(value.requestId)) return null;
  const result = decodeRequestResult(value.result, decodeUiColors);
  return result ? { type: value.type, requestId: value.requestId, result } : null;
}
