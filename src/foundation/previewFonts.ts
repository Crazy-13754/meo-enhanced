import { normalizePreviewFontFamily } from './previewFontFamily';

export type PreviewFont = Readonly<{ family: string; aliases: readonly string[] }>;
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
    fonts.push({ family, aliases: aliases as string[] });
  }
  return fonts;
}

/** Family names, rather than face/style names, are the values saved by every preset. */
export function mergePreviewFonts(fonts: readonly PreviewFont[]): readonly PreviewFont[] {
  const families = new Map<string, { family: string; aliases: Set<string> }>();
  for (const font of fonts) {
    const family = normalizePreviewFontFamily(font.family);
    if (!family) continue;
    const key = family.toLocaleLowerCase();
    const entry = families.get(key) ?? { family, aliases: new Set<string>() };
    for (const alias of font.aliases) {
      const normalized = normalizePreviewFontFamily(alias);
      if (normalized && normalized !== family) entry.aliases.add(normalized);
    }
    families.set(key, entry);
  }
  return [...families.values()].sort((a, b) => a.family.localeCompare(b.family))
    .map(({ family, aliases }) => ({ family, aliases: [...aliases].slice(0, 32) }));
}
