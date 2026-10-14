import type { PreviewPresetBaseId, PreviewPresetCodeTheme, PreviewPresetDefinition } from './previewPresets';
import type { UiLanguage } from './uiLanguage';

export const MAX_PRESET_FILE_BYTES = 512 * 1024;
export const MAX_PRESET_PACKAGE_BYTES = 2 * 1024 * 1024;
export const presetCodeThemes: readonly PreviewPresetCodeTheme[] = ['light-plus', 'dark-plus', 'github-light-default', 'github-dark-default'];

export type CustomPreviewControlPolicy = { mode: 'editable' } | { mode: 'fixed'; value: boolean };

export type CustomPreviewPresetManifest = {
  schemaVersion: 1;
  id: string;
  name: string | Partial<Record<UiLanguage, string>>;
  description: string | Partial<Record<UiLanguage, string>>;
  base: PreviewPresetBaseId;
  controls?: Partial<Record<'htmlComments' | 'codeColoring', CustomPreviewControlPolicy>> & { fontFamily?: { mode: 'editable' | 'fixed' } };
  styles?: { common?: string };
  themes: Partial<Record<'light' | 'dark', { css: string; codeTheme?: PreviewPresetCodeTheme }>>;
  author?: string;
  version?: string;
  source?: string;
  license?: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${field}.${key}: unknown field`);
}

function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field}: expected non-empty text (max ${limit})`);
  return value.trim();
}

function localizedText(value: unknown, field: 'name' | 'description', limit: number): CustomPreviewPresetManifest['description'] {
  if (typeof value === 'string') return text(value, field, limit);
  if (!record(value)) throw new Error(`${field}: expected text or an en / zh-CN object`);
  keys(value, ['en', 'zh-CN'], field);
  const result: Partial<Record<UiLanguage, string>> = {};
  for (const language of ['en', 'zh-CN'] as const) {
    if (value[language] !== undefined) result[language] = text(value[language], `${field}.${language}`, limit);
  }
  if (!result.en && !result['zh-CN']) throw new Error(`${field}: provide en and/or zh-CN`);
  return result;
}

/** Files must remain inside the selected package, including after path normalization. */
export function presetCssPath(value: unknown, field: string): string {
  const path = text(value, field, 240);
  if (!/^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*\.css$/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new Error(`${field}: expected a relative CSS path inside the preset folder`);
  return path;
}

export function parseCustomPreviewPresetManifest(value: unknown): CustomPreviewPresetManifest {
  if (!record(value)) throw new Error('preset: expected an object');
  keys(value, ['$schema', 'schemaVersion', 'id', 'name', 'description', 'base', 'controls', 'styles', 'themes', 'author', 'version', 'source', 'license'], 'preset');
  if (value.schemaVersion !== 1) throw new Error('schemaVersion: only version 1 is supported');
  const id = text(value.id, 'id', 64);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('id: use lowercase letters, digits and hyphens, starting with a letter');
  const base = value.base ?? 'default';
  if (base !== 'default' && base !== 'github-readme') throw new Error('base: expected default or github-readme');
  const result: CustomPreviewPresetManifest = { schemaVersion: 1, id, base, name: localizedText(value.name, 'name', 80), description: localizedText(value.description, 'description', 500), themes: {} };
  if (value.controls !== undefined) {
    if (!record(value.controls)) throw new Error('controls: expected an object');
    keys(value.controls, ['fontFamily', 'htmlComments', 'codeColoring'], 'controls');
    result.controls = {};
    if (value.controls.fontFamily !== undefined) {
      const policy = value.controls.fontFamily;
      if (!record(policy)) throw new Error('controls.fontFamily: expected an object');
      keys(policy, ['mode'], 'controls.fontFamily');
      if (policy.mode !== 'editable' && policy.mode !== 'fixed') throw new Error('controls.fontFamily.mode: expected editable or fixed');
      result.controls.fontFamily = { mode: policy.mode };
    }
    for (const field of ['htmlComments', 'codeColoring'] as const) {
      const policy = value.controls[field];
      if (policy === undefined) continue;
      if (!record(policy)) throw new Error(`controls.${field}: expected an object`);
      if (policy.mode === 'editable') {
        keys(policy, ['mode'], `controls.${field}`);
        result.controls[field] = { mode: 'editable' };
      } else if (policy.mode === 'fixed') {
        keys(policy, ['mode', 'value'], `controls.${field}`);
        if (typeof policy.value !== 'boolean') throw new Error(`controls.${field}.value: expected a boolean`);
        result.controls[field] = { mode: 'fixed', value: policy.value };
      } else throw new Error(`controls.${field}.mode: expected editable or fixed`);
    }
  }
  if (value.styles !== undefined) {
    if (!record(value.styles)) throw new Error('styles: expected an object');
    keys(value.styles, ['common'], 'styles');
    result.styles = value.styles.common === undefined ? {} : { common: presetCssPath(value.styles.common, 'styles.common') };
  }
  if (!record(value.themes)) throw new Error('themes: provide light and/or dark');
  keys(value.themes, ['light', 'dark'], 'themes');
  for (const appearance of ['light', 'dark'] as const) {
    const theme = value.themes[appearance];
    if (theme === undefined) continue;
    if (!record(theme)) throw new Error(`themes.${appearance}: expected an object`);
    keys(theme, ['css', 'codeTheme'], `themes.${appearance}`);
    if (theme.codeTheme !== undefined && !presetCodeThemes.includes(theme.codeTheme as PreviewPresetCodeTheme)) throw new Error(`themes.${appearance}.codeTheme: unsupported code theme`);
    result.themes[appearance] = { css: presetCssPath(theme.css, `themes.${appearance}.css`), ...(theme.codeTheme === undefined ? {} : { codeTheme: theme.codeTheme as PreviewPresetCodeTheme }) };
  }
  if (!result.themes.light && !result.themes.dark) throw new Error('themes: provide at least one theme');
  for (const field of ['author', 'version', 'source', 'license'] as const) if (value[field] !== undefined) result[field] = text(value[field], field, 500);
  return result;
}

export function createCustomPreviewPreset(manifest: CustomPreviewPresetManifest, css: NonNullable<PreviewPresetDefinition['custom']>['css'], revision: string): PreviewPresetDefinition {
  const both = Boolean(manifest.themes.light && manifest.themes.dark);
  const appearance = both ? 'auto' : manifest.themes.light ? 'light' : 'dark';
  const localizedName = typeof manifest.name === 'string'
    ? { en: manifest.name, 'zh-CN': manifest.name }
    : { en: manifest.name.en ?? manifest.name['zh-CN']!, 'zh-CN': manifest.name['zh-CN'] ?? manifest.name.en! };
  const localizedDescription = typeof manifest.description === 'string'
    ? { en: manifest.description, 'zh-CN': manifest.description }
    : { en: manifest.description.en ?? manifest.description['zh-CN']!, 'zh-CN': manifest.description['zh-CN'] ?? manifest.description.en! };
  return {
    schemaVersion: 1, id: `user:${manifest.id}`, renderer: 'meo',
    name: localizedName, description: localizedDescription,
    defaults: { contentWidth: 'responsive' }, notes: [],
    controls: { fontFamily: manifest.controls?.fontFamily ?? { mode: 'fixed' }, contentWidth: { mode: 'fixed' },
      appearance: { mode: both ? 'editable' : 'fixed', options: both ? ['auto', 'light', 'dark'] : [appearance] },
      codeColoring: manifest.controls?.codeColoring ?? { mode: 'editable' },
      htmlComments: manifest.controls?.htmlComments ?? { mode: 'editable' } },
    custom: { base: manifest.base, revision, css, codeThemes: {
      ...(manifest.themes.light?.codeTheme ? { light: manifest.themes.light.codeTheme } : {}),
      ...(manifest.themes.dark?.codeTheme ? { dark: manifest.themes.dark.codeTheme } : {}) } }
  };
}

/** Catalog messages contain data only; the Host remains the authority for rendering. */
export function decodeCustomPreviewPresets(value: unknown): PreviewPresetDefinition[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const presets: PreviewPresetDefinition[] = [];
  for (const item of value) {
    if (!record(item) || !record(item.controls) || !record(item.controls.htmlComments) || !record(item.controls.codeColoring) || !record(item.custom) || !record(item.custom.css) || !record(item.custom.codeThemes) || !record(item.name) || !record(item.description) || typeof item.id !== 'string' || !item.id.startsWith('user:') || typeof item.custom.revision !== 'string' || !/^[a-f0-9]{64}$/.test(item.custom.revision) || ids.has(item.id)) return null;
    try {
      const themes: CustomPreviewPresetManifest['themes'] = {};
      for (const appearance of ['light', 'dark'] as const) if (item.custom.css[appearance] !== undefined) {
        if (typeof item.custom.css[appearance] !== 'string' || item.custom.css[appearance].length > MAX_PRESET_FILE_BYTES) return null;
        themes[appearance] = { css: `${appearance}.css`, ...(item.custom.codeThemes[appearance] === undefined ? {} : { codeTheme: item.custom.codeThemes[appearance] as PreviewPresetCodeTheme }) };
      }
      if (item.custom.css.common !== undefined && (typeof item.custom.css.common !== 'string' || item.custom.css.common.length > MAX_PRESET_FILE_BYTES)) return null;
      const manifest = parseCustomPreviewPresetManifest({ schemaVersion: 1, id: item.id.slice(5), name: item.name, description: item.description, base: item.custom.base,
        controls: { fontFamily: item.controls.fontFamily, htmlComments: item.controls.htmlComments, codeColoring: item.controls.codeColoring }, themes });
      presets.push(createCustomPreviewPreset(manifest, item.custom.css, item.custom.revision));
      ids.add(item.id);
    } catch { return null; }
  }
  return presets;
}
