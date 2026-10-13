// Static text imports keep the reading presets available in offline Preview and exports.
import common from './common.css' with { type: 'text' };
import newsprint from '../newsprint/light.css' with { type: 'text' };
import whiteyCommon from '../whitey/common.css' with { type: 'text' };
import whiteyLight from '../whitey/light.css' with { type: 'text' };
import whiteyDark from '../whitey/dark.css' with { type: 'text' };
import minimalLight from '../obsidian-minimal/light.css' with { type: 'text' };
import minimalDark from '../obsidian-minimal/dark.css' with { type: 'text' };

export function getReadingPresetStyles(id, appearance) {
  const css = id === 'newsprint' ? newsprint : id === 'whitey' ? `${whiteyCommon}\n${appearance === 'light' ? whiteyLight : whiteyDark}`
    : id === 'obsidian-minimal' ? appearance === 'light' ? minimalLight : minimalDark : null;
  if (css === null) throw new Error(`Reading preset styles are unavailable: ${id}`);
  return `${common}\n${css}`;
}
