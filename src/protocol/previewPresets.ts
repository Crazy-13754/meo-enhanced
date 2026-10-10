import { decodeCustomPreviewPresets } from '../foundation/customPreviewPreset';
import { isPreviewPresetId, type PreviewPresetDefinition, type PreviewPresetDiagnostic, type PreviewPresetId } from '../foundation/previewPresets';

export type PreviewPresetsChanged = {
  readonly type: 'previewPresetsChanged';
  readonly presets: readonly PreviewPresetDefinition[];
  readonly diagnostics?: readonly PreviewPresetDiagnostic[];
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
  if (!presets || !diagnostics || candidate.selected?.startsWith('user:') && !presets.some(preset => preset.id === candidate.selected)) return null;
  return { type: 'previewPresetsChanged', presets, diagnostics, ...(candidate.selected ? { selected: candidate.selected } : {}) };
}
