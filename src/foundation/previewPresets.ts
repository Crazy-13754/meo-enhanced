import defaultDefinition from '../preview/presets/default/preset.json';
import githubDefinition from '../preview/presets/github-readme/preset.json';
import type { UiLanguage } from './uiLanguage';

export type PreviewPresetId = 'default' | 'github-readme';
export type PreviewContentWidth = 'responsive' | 'reference';
type LocalizedText = Readonly<Record<UiLanguage, string>>;
export type PreviewControlPolicy = Readonly<{
  mode: 'editable' | 'fixed' | 'unsupported';
  value?: boolean;
  options?: readonly string[];
}>;
export type PreviewPresetDefinition = Readonly<{
  schemaVersion: 1;
  id: PreviewPresetId;
  name: LocalizedText;
  description: LocalizedText;
  renderer: 'meo' | 'github-readme';
  styles?: Readonly<Record<'light' | 'dark', string>>;
  source?: Readonly<{ url: string; version: string; commit: string }>;
  defaults: Readonly<{ appearance: 'auto' | 'light' | 'dark'; contentWidth: PreviewContentWidth }>;
  controls: Readonly<Record<'fontFamily' | 'appearance' | 'codeColoring' | 'htmlComments' | 'contentWidth', PreviewControlPolicy>>;
  notes: readonly LocalizedText[];
}>;

export const previewPresets: readonly PreviewPresetDefinition[] = [
  defaultDefinition as PreviewPresetDefinition,
  githubDefinition as PreviewPresetDefinition
];

export function isPreviewPresetId(value: unknown): value is PreviewPresetId {
  return previewPresets.some(preset => preset.id === value);
}

export function getPreviewPreset(id: PreviewPresetId = 'default'): PreviewPresetDefinition {
  return previewPresets.find(preset => preset.id === id) ?? previewPresets[0];
}

/** Fixed preset values never overwrite the user's settings for the Default preset. */
export function resolvePreviewPresetSettings(id: PreviewPresetId, settings: {
  readonly previewFontFamily: string;
  readonly previewSourceColoring?: boolean;
  readonly previewShowComments?: boolean;
}) {
  const { controls } = getPreviewPreset(id);
  return {
    previewFontFamily: controls.fontFamily.mode === 'editable' ? settings.previewFontFamily : '',
    previewSourceColoring: controls.codeColoring.mode === 'editable' ? settings.previewSourceColoring !== false : controls.codeColoring.mode === 'fixed' && controls.codeColoring.value === true,
    previewShowComments: controls.htmlComments.mode === 'editable' ? settings.previewShowComments === true : controls.htmlComments.mode === 'fixed' && controls.htmlComments.value === true
  };
}

export type PreviewPresetState = {
  readonly preset: PreviewPresetId;
  readonly preferences: Partial<Record<PreviewPresetId, {
    appearance: 'auto' | 'light' | 'dark';
    contentWidth: PreviewContentWidth;
  }>>;
};

export function decodePreviewPresetState(value: unknown): PreviewPresetState | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<PreviewPresetState>;
  if (!isPreviewPresetId(candidate.preset) || typeof candidate.preferences !== 'object' || candidate.preferences === null) return null;
  const preferences: PreviewPresetState['preferences'] = {};
  for (const preset of previewPresets) {
    const preference = candidate.preferences[preset.id];
    if (!preference) continue;
    if (!['auto', 'light', 'dark'].includes(preference.appearance)
      || !['responsive', 'reference'].includes(preference.contentWidth)) return null;
    preferences[preset.id] = {
      appearance: preference.appearance,
      contentWidth: preset.controls.contentWidth.mode === 'editable' ? preference.contentWidth : preset.defaults.contentWidth
    };
  }
  return { preset: candidate.preset, preferences };
}
