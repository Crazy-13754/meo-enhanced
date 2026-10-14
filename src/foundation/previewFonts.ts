import { normalizePreviewFontFamily } from './previewFontFamily';
import { isUiLanguage, type UiLanguage } from './uiLanguage';

export type PreviewFont = Readonly<{
  family: string;
  aliases: readonly string[];
  /** Locale-tagged system names are display labels; family remains the saved CSS value. */
  localizedFamilies?: Readonly<Partial<Record<UiLanguage, string>>>;
}>;
export const fallbackPreviewFonts: readonly PreviewFont[] = [
  'Microsoft YaHei', 'Segoe UI', 'Noto Sans CJK SC', 'Source Han Sans SC', 'SimSun', 'Arial', 'Georgia'
].map(family => ({ family, aliases: [] }));

export function decodePreviewFonts(value: unknown): readonly PreviewFont[] | null {
  if (!Array.isArray(value) || value.length > 10000) return null;
  const fonts: PreviewFont[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const family = normalizePreviewFontFamily(entry.family);
    if (!family || !Array.isArray(entry.aliases) || entry.aliases.length > 32) return null;
    const aliases = entry.aliases.map(normalizePreviewFontFamily);
    if (aliases.some((alias: string | null) => !alias)) return null;
    let localizedFamilies: Partial<Record<UiLanguage, string>> | undefined;
    if (entry.localizedFamilies !== undefined) {
      if (!entry.localizedFamilies || typeof entry.localizedFamilies !== 'object' || Array.isArray(entry.localizedFamilies)) return null;
      localizedFamilies = {};
      for (const [language, name] of Object.entries(entry.localizedFamilies)) {
        const normalized = normalizePreviewFontFamily(name);
        if (!isUiLanguage(language) || !normalized) return null;
        localizedFamilies[language] = normalized;
      }
    }
    fonts.push({ family, aliases: aliases as string[], ...(localizedFamilies ? { localizedFamilies } : {}) });
  }
  return fonts;
}

/** Family names, rather than face/style names, are the values saved by every preset. */
export function mergePreviewFonts(fonts: readonly PreviewFont[]): readonly PreviewFont[] {
  const families = new Map<string, { family: string; aliases: Set<string>; localizedFamilies?: Partial<Record<UiLanguage, string>> }>();
  for (const font of fonts) {
    const family = normalizePreviewFontFamily(font.family);
    if (!family) continue;
    const key = family.toLocaleLowerCase();
    const entry = families.get(key) ?? { family, aliases: new Set<string>(), localizedFamilies: undefined };
    for (const alias of font.aliases) {
      const normalized = normalizePreviewFontFamily(alias);
      if (normalized && normalized !== family) entry.aliases.add(normalized);
    }
    for (const [language, name] of Object.entries(font.localizedFamilies ?? {})) {
      const normalized = normalizePreviewFontFamily(name);
      if (isUiLanguage(language) && normalized) {
        entry.localizedFamilies ??= {};
        entry.localizedFamilies[language] ??= normalized;
      }
    }
    families.set(key, entry);
  }
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family))
    .map(({ family, aliases, localizedFamilies }) => ({ family, aliases: [...aliases].slice(0, 32), ...(localizedFamilies ? { localizedFamilies } : {}) }));
}
