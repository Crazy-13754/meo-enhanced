import { decodeCustomPreviewPresets } from '../foundation/customPreviewPreset';
import { isPreviewPresetId, type PreviewPresetDefinition, type PreviewPresetDiagnostic, type PreviewPresetId } from '../foundation/previewPresets';
import { isUiLanguage, type UiLanguage } from '../foundation/uiLanguage';
import { decodeRequestResult, type RequestResult } from './requestResult';

export type PreviewPresetAction = { readonly language: UiLanguage } & (
  { readonly action: 'import' | 'guide' }
  | { readonly action: 'export' | 'remove'; readonly preset: PreviewPresetId }
  | { readonly action: 'setEnabled'; readonly preset: PreviewPresetId; readonly enabled: boolean }
);
export type PreviewPresetRequest = PreviewPresetAction & { readonly type: 'previewPresetRequest'; readonly requestId: string };
export type PreviewPresetResponse = { readonly type: 'previewPresetResult'; readonly requestId: string; readonly result: RequestResult<{ readonly changed: boolean }> };
export type OpenPreviewPresetSettings = { readonly type: 'openPreviewPresetSettings' };

/** Only custom presets can be hidden, exported or removed. */
export function decodeDisabledPreviewPresets(value: unknown): PreviewPresetId[] | null {
  return Array.isArray(value) && value.length <= 100 && value.every(id => isPreviewPresetId(id) && id.startsWith('user:'))
    ? [...new Set(value)] : null;
}

export function decodePreviewPresetRequest(value: unknown): PreviewPresetRequest | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as PreviewPresetRequest;
  if (item.type !== 'previewPresetRequest' || typeof item.requestId !== 'string' || !item.requestId || item.requestId.length > 200 || !isUiLanguage(item.language)) return null;
  const common = { type: item.type, requestId: item.requestId, language: item.language };
  if (item.action === 'import' || item.action === 'guide') return { ...common, action: item.action };
  if (!('preset' in item) || !isPreviewPresetId(item.preset) || !item.preset.startsWith('user:')) return null;
  if (item.action === 'export' || item.action === 'remove') return { ...common, action: item.action, preset: item.preset };
  return item.action === 'setEnabled' && typeof item.enabled === 'boolean' ? { ...common, action: item.action, preset: item.preset, enabled: item.enabled } : null;
}

export function decodePreviewPresetResponse(value: unknown): PreviewPresetResponse | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as PreviewPresetResponse;
  if (item.type !== 'previewPresetResult' || typeof item.requestId !== 'string' || !item.requestId) return null;
  const result = decodeRequestResult(item.result, data => data && typeof data === 'object' && 'changed' in data && typeof data.changed === 'boolean' ? { changed: data.changed } : null);
  return result ? { type: item.type, requestId: item.requestId, result } : null;
}

export type PreviewPresetsChanged = {
  readonly type: 'previewPresetsChanged';
  readonly presets: readonly PreviewPresetDefinition[];
  readonly diagnostics?: readonly PreviewPresetDiagnostic[];
  readonly disabled?: readonly PreviewPresetId[];
  readonly selected?: PreviewPresetId;
};

export function decodePreviewPresetDiagnostics(value: unknown): PreviewPresetDiagnostic[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const diagnostics: PreviewPresetDiagnostic[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.message !== 'string' || !item.message.trim() || item.message.length > 8000
      || item.preset !== undefined && (!isPreviewPresetId(item.preset) || !item.preset.startsWith('user:'))) return null;
    diagnostics.push({ ...(item.preset ? { preset: item.preset } : {}), message: item.message });
  }
  return diagnostics;
}

export function decodePreviewPresetsChanged(value: unknown): PreviewPresetsChanged | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as PreviewPresetsChanged;
  if (candidate.type !== 'previewPresetsChanged' || candidate.selected !== undefined && !isPreviewPresetId(candidate.selected)) return null;
  const presets = decodeCustomPreviewPresets(candidate.presets);
  const diagnostics = decodePreviewPresetDiagnostics(candidate.diagnostics ?? []);
  const disabled = decodeDisabledPreviewPresets(candidate.disabled ?? []);
  if (!presets || !diagnostics || !disabled || candidate.selected?.startsWith('user:') && (!presets.some(preset => preset.id === candidate.selected) || disabled.includes(candidate.selected))) return null;
  return { type: 'previewPresetsChanged', presets, diagnostics, disabled, ...(candidate.selected ? { selected: candidate.selected } : {}) };
}
