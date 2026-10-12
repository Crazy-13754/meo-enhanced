// Static text imports keep the reading presets available in offline Preview and exports.
import common from './common.css' with { type: 'text' };
import newsprint from '../newsprint/light.css' with { type: 'text' };
import whitey from '../whitey/light.css' with { type: 'text' };
import minimalLight from '../obsidian-minimal/light.css' with { type: 'text' };
import minimalDark from '../obsidian-minimal/dark.css' with { type: 'text' };

export function getReadingPresetStyles(id, appearance) {
  const css = id === 'newsprint' ? newsprint : id === 'whitey' ? whitey
    : id === 'obsidian-minimal' ? appearance === 'light' ? minimalLight : minimalDark : null;
  if (css === null) throw new Error(`Reading preset styles are unavailable: ${id}`);
  return `${common}\n${css}`;
}
