type Theme = { name: string; colors: Record<string, string>; tokenColors: unknown[] };
type Settings = Record<string, unknown>;

const tokenGroups: Record<string, string[]> = {
  comments: ['comment', 'punctuation.definition.comment'],
  strings: ['string', 'meta.embedded.assembly'],
  keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
  numbers: ['constant.numeric'],
  types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
  functions: ['entity.name.function', 'support.function'],
  variables: ['variable', 'entity.name.variable']
};

function matchesTheme(selector: string, name: string): boolean {
  if (selector === name) return true;
  const leading = selector.startsWith('*');
  const trailing = selector.endsWith('*');
  const text = selector.slice(leading ? 1 : 0, trailing ? -1 : undefined);
  return leading && trailing ? name.includes(text) : leading ? name.endsWith(text) : trailing && name.startsWith(text);
}

function customizationLayers(settings: Settings, name: string): Settings[] {
  const scoped: Settings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith('[') || !key.endsWith(']') || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const match of key.matchAll(/\[([^\]]*)\]/g)) {
      if (!matchesTheme(match[1]!, name)) continue;
      for (const [id, override] of Object.entries(value)) {
        if (!override) continue;
        scoped[id] = Array.isArray(scoped[id]) && Array.isArray(override) ? [...scoped[id] as unknown[], ...override] : override;
      }
    }
  }
  return [settings, scoped];
}

/** VS Code applies general settings first, then matching theme sections and specific TextMate rules. */
export function resolveSourceThemeCustomizations(theme: Theme, colors: Settings = {}, tokens: Settings = {}) {
  const sourceColors = { ...theme.colors };
  for (const layer of customizationLayers(colors, theme.name)) {
    for (const [id, value] of Object.entries(layer)) {
      if (id.startsWith('[')) continue;
      if (value === 'default') delete sourceColors[id];
      else if (typeof value === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) sourceColors[id] = value;
    }
  }
  const sourceTokenColors = [...theme.tokenColors];
  for (const layer of customizationLayers(tokens, theme.name)) {
    for (const [group, scope] of Object.entries(tokenGroups)) {
      const value = layer[group];
      if (typeof value === 'string') sourceTokenColors.push({ scope, settings: { foreground: value } });
      else if (value && typeof value === 'object' && !Array.isArray(value)) sourceTokenColors.push({ scope, settings: value });
    }
    if (Array.isArray(layer.textMateRules)) {
      sourceTokenColors.push(...layer.textMateRules.filter(rule => rule && typeof rule === 'object' && rule.scope && rule.settings));
    }
  }
  return { sourceColors, sourceTokenColors };
}
