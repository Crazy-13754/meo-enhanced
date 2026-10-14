import defaultDefinition from '../preview/presets/default/preset.json';
import githubDefinition from '../preview/presets/github-readme/preset.json';
import newsprintDefinition from '../preview/presets/newsprint/preset.json';
import minimalDefinition from '../preview/presets/obsidian-minimal/preset.json';
import whiteyDefinition from '../preview/presets/whitey/preset.json';
import type { UiLanguage } from './uiLanguage';
import { normalizePreviewFontFamily } from './previewFontFamily';

export type PreviewPresetBaseId = 'default' | 'github-readme';
export type BuiltInPreviewPresetId = PreviewPresetBaseId | 'newsprint' | 'obsidian-minimal' | 'whitey';
export type PreviewPresetId = BuiltInPreviewPresetId | `user:${string}`;
export type PreviewPresetCodeTheme = 'light-plus' | 'dark-plus' | 'github-light-default' | 'github-dark-default';
export type PreviewContentWidth = 'responsive' | 'reference';
export type PreviewPresetDiagnostic = Readonly<{ preset?: PreviewPresetId; message: string }>;
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
  styles?: Readonly<Partial<Record<'light' | 'dark', string>>>;
  source?: Readonly<{ url: string; version?: string; commit?: string }>;
  author?: string;
  version?: string;
  license?: string;
  defaults: Readonly<{ contentWidth: PreviewContentWidth }>;
  controls: Readonly<Record<'fontFamily' | 'appearance' | 'codeColoring' | 'htmlComments' | 'contentWidth', PreviewControlPolicy>>;
  notes: readonly LocalizedText[];
  custom?: Readonly<{
    base: PreviewPresetBaseId;
    revision: string;
    css: Readonly<Partial<Record<'common' | 'light' | 'dark', string>>>;
    codeThemes: Readonly<Partial<Record<'light' | 'dark', PreviewPresetCodeTheme>>>;
  }>;
}>;

const builtInPresets: readonly PreviewPresetDefinition[] = [
  defaultDefinition as PreviewPresetDefinition,
  githubDefinition as PreviewPresetDefinition,
  newsprintDefinition as PreviewPresetDefinition,
  whiteyDefinition as PreviewPresetDefinition,
  minimalDefinition as PreviewPresetDefinition
];
export const previewPresets: PreviewPresetDefinition[] = [...builtInPresets];
let disabledPresets: readonly PreviewPresetId[] = [];

export function isPreviewPresetEnabled(id: PreviewPresetId): boolean {
  return !id.startsWith('user:') || !disabledPresets.includes(id);
}

/** Only Host-validated presets enter the catalog; built-ins cannot be replaced. */
export function replaceCustomPreviewPresets(presets: readonly PreviewPresetDefinition[], disabled: readonly PreviewPresetId[] = []): void {
  previewPresets.splice(0, previewPresets.length, ...builtInPresets, ...presets);
  disabledPresets = disabled.filter(id => id.startsWith('user:'));
}

export function isPreviewPresetId(value: unknown): value is PreviewPresetId {
  return builtInPresets.some(preset => preset.id === value)
    || typeof value === 'string' && /^user:[a-z][a-z0-9-]{0,63}$/.test(value);
}

export function getPreviewPreset(id: PreviewPresetId = 'default'): PreviewPresetDefinition {
  const preset = previewPresets.find(preset => preset.id === id);
  if (!preset) throw new Error(`Preview preset is unavailable: ${id}`);
  return preset;
}

/** Only Default follows the editor; other presets own a fixed palette for each resolved appearance. */
export function getPreviewPresetCodeTheme(preset: PreviewPresetDefinition, appearance: 'light' | 'dark'): PreviewPresetCodeTheme | undefined {
  if (preset.id === 'default') return undefined;
  return preset.custom?.codeThemes[appearance]
    ?? (preset.renderer === 'github-readme' || preset.custom?.base === 'github-readme'
      ? appearance === 'light' ? 'github-light-default' : 'github-dark-default'
      : appearance === 'light' ? 'light-plus' : 'dark-plus');
}

/** A dual-theme preset starts in Auto; a single-theme preset uses its supported theme. */
export function getPresetInitialAppearance(preset: PreviewPresetDefinition): 'auto' | 'light' | 'dark' {
  const options = preset.controls.appearance.options ?? [];
  return options.includes('light') && options.includes('dark') ? 'auto' : options.includes('light') ? 'light' : options.includes('dark') ? 'dark' : 'auto';
}

export function normalizePresetAppearance(preset: PreviewPresetDefinition, preference: 'auto' | 'light' | 'dark'): 'auto' | 'light' | 'dark' {
  return preset.controls.appearance.options?.includes(preference) ? preference : getPresetInitialAppearance(preset);
}

export function resolvePresetAppearance(preset: PreviewPresetDefinition, preference: 'auto' | 'light' | 'dark', editor: 'light' | 'dark'): 'light' | 'dark' {
  const normalized = normalizePresetAppearance(preset, preference);
  return normalized === 'auto' ? editor : normalized;
}

/** Fixed preset values never overwrite the user's settings for the Default preset. */
export function resolvePreviewPresetSettings(id: PreviewPresetId, settings: {
  readonly previewFontFamily: string;
  readonly previewSourceColoring?: boolean;
  readonly previewShowComments?: boolean;
}, definition = getPreviewPreset(id)) {
  const { controls } = definition;
  return {
    previewFontFamily: controls.fontFamily.mode === 'editable' ? settings.previewFontFamily : '',
    previewSourceColoring: controls.codeColoring.mode === 'editable' ? settings.previewSourceColoring !== false : controls.codeColoring.mode === 'fixed' && controls.codeColoring.value === true,
    previewShowComments: controls.htmlComments.mode === 'editable' ? settings.previewShowComments === true : controls.htmlComments.mode === 'fixed' && controls.htmlComments.value === true
  };
}

export type PreviewPresetPreference = {
  appearance: 'auto' | 'light' | 'dark';
  contentWidth: PreviewContentWidth;
  fontFamily?: string;
  sourceColoring?: boolean;
  showComments?: boolean;
};
export type PreviewPresetPreferencePatch = Partial<PreviewPresetPreference>;
export type PreviewPresetPreferences = Partial<Record<PreviewPresetId, PreviewPresetPreference>>;

export function decodePreviewPresetPreferencePatch(value: unknown): PreviewPresetPreferencePatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const preference = value as Record<string, unknown>;
  if (!Object.values(preference).some(value => value !== undefined) || Object.keys(preference).some(key => !['appearance', 'contentWidth', 'fontFamily', 'sourceColoring', 'showComments'].includes(key))) return null;
  if (preference.appearance !== undefined && !['auto', 'light', 'dark'].includes(preference.appearance as string)
    || preference.contentWidth !== undefined && !['responsive', 'reference'].includes(preference.contentWidth as string)
    || preference.sourceColoring !== undefined && typeof preference.sourceColoring !== 'boolean'
    || preference.showComments !== undefined && typeof preference.showComments !== 'boolean') return null;
  const fontFamily = preference.fontFamily === undefined ? undefined : normalizePreviewFontFamily(preference.fontFamily);
  if (fontFamily === null) return null;
  return { ...preference, ...(fontFamily === undefined ? {} : { fontFamily }) } as PreviewPresetPreferencePatch;
}

export function decodePreviewPresetPreference(value: unknown): PreviewPresetPreference | null {
  const preference = decodePreviewPresetPreferencePatch(value);
  return preference?.appearance !== undefined && preference.contentWidth !== undefined ? preference as PreviewPresetPreference : null;
}

/** Decode without consulting the current catalog so temporarily unavailable custom presets retain their preferences. */
export function decodePreviewPresetPreferences(value: unknown): PreviewPresetPreferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const preferences: PreviewPresetPreferences = {};
  for (const [id, raw] of Object.entries(value)) {
    const preference = decodePreviewPresetPreference(raw);
    if (!isPreviewPresetId(id) || !preference) return null;
    preferences[id] = preference;
  }
  return preferences;
}

/** Only editable fields can override a preset's policy. Used at both persistence and presentation boundaries. */
export function editablePreviewPresetPreference(preset: PreviewPresetDefinition, preference: PreviewPresetPreferencePatch): PreviewPresetPreferencePatch {
  const { controls } = preset;
  return {
    ...(controls.appearance.mode === 'editable' && preference.appearance !== undefined && controls.appearance.options?.includes(preference.appearance) ? { appearance: preference.appearance } : {}),
    ...(controls.contentWidth.mode === 'editable' && preference.contentWidth !== undefined && controls.contentWidth.options?.includes(preference.contentWidth) ? { contentWidth: preference.contentWidth } : {}),
    ...(controls.fontFamily.mode === 'editable' && preference.fontFamily !== undefined ? { fontFamily: preference.fontFamily } : {}),
    ...(controls.codeColoring.mode === 'editable' && preference.sourceColoring !== undefined ? { sourceColoring: preference.sourceColoring } : {}),
    ...(controls.htmlComments.mode === 'editable' && preference.showComments !== undefined ? { showComments: preference.showComments } : {})
  };
}

export type PreviewPresetState = {
  readonly preset: PreviewPresetId;
  readonly preferences: PreviewPresetPreferences;
};

export function decodePreviewPresetState(value: unknown): PreviewPresetState | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<PreviewPresetState>;
  const preferences = decodePreviewPresetPreferences(candidate.preferences);
  if (!isPreviewPresetId(candidate.preset) || !preferences) return null;
  for (const preset of previewPresets) {
    const preference = preferences[preset.id];
    if (!preference) continue;
    preferences[preset.id] = {
      ...editablePreviewPresetPreference(preset, preference),
      appearance: normalizePresetAppearance(preset, preference.appearance),
      contentWidth: preset.controls.contentWidth.mode === 'editable' && preset.controls.contentWidth.options?.includes(preference.contentWidth) ? preference.contentWidth : preset.defaults.contentWidth
    };
  }
  return { preset: previewPresets.some(preset => preset.id === candidate.preset) && isPreviewPresetEnabled(candidate.preset) ? candidate.preset : 'default', preferences };
}
