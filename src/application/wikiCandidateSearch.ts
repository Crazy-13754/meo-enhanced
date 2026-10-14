import { candidateTextMatch } from '../foundation/candidateText';

export type WikiSearchEntry = {
  readonly path: string;
  readonly name: string;
  readonly title?: string;
  readonly aliases?: readonly string[];
};

/** Search fields affect ranking and display, never the identity of a link target. */
export function searchWikiCandidates(entries: readonly WikiSearchEntry[], query: string, documentDirectory: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const directoryParts = documentDirectory.split('/').filter(Boolean);
  const scored = entries.flatMap(entry => {
    const slash = query.lastIndexOf('/');
    if (slash >= 0) {
      const requested = query.slice(0, slash).toLowerCase(), parent = entry.path.split('/').slice(0, -1).join('/').toLowerCase();
      if (requested && parent !== requested && !parent.startsWith(requested + '/') && !parent.endsWith('/' + requested) && !parent.includes('/' + requested + '/')) return [];
    }
    const fields = [{ text: entry.name, weight: 0 }, ...(entry.aliases ?? []).map(text => ({ text, weight: 10 })),
      ...(entry.title && entry.title !== entry.name ? [{ text: entry.title, weight: 20 }] : []), { text: entry.path, weight: 1000 }];
    let score = 0, display = entry.name;
    const full = fields.slice(0, -1).map(field => ({ field, match: candidateTextMatch(field.text, query.trim()) }))
      .filter(value => value.match).sort((a, b) => a.match!.rank + a.field.weight - b.match!.rank - b.field.weight)[0];
    if (tokens.length && full && full.field.weight > 0 && full.match!.rank < (candidateTextMatch(entry.name, query.trim())?.rank ?? Infinity)) display = full.field.text;
    for (const token of tokens) {
      const matches = fields.map(field => ({ field, match: candidateTextMatch(field.text, token) })).filter(value => value.match)
        .sort((a, b) => a.match!.rank + a.field.weight - b.match!.rank - b.field.weight);
      if (!matches.length) return [];
      score += matches[0].match!.rank + matches[0].field.weight;
      if (!full && display === entry.name && matches[0].field.weight > 0 && matches[0].field.weight < 1000) display = matches[0].field.text;
    }
    if (full?.match?.rank === 0 && tokens.length) score = full.field.weight;
    const parts = entry.path.split('/').slice(0, -1);
    let shared = 0;
    while (shared < parts.length && shared < directoryParts.length && parts[shared] === directoryParts[shared]) shared++;
    return [{ entry, display, score, distance: parts.length + directoryParts.length - shared * 2 }];
  });
  return scored.sort((a, b) => a.score - b.score || a.distance - b.distance || a.entry.path.length - b.entry.path.length
    || (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0)).slice(0, 50);
}

/** Keep the extension for dotted stems; compare names using the provider's casing. */
export function shortestWikiTarget(path: string, paths: readonly string[], ignoreCase = false): string {
  const stem = (value: string) => value.replace(/\.(?:md|markdown|mdx|mdc)$/i, '');
  const compare = (value: string) => ignoreCase ? value.toLowerCase() : value;
  const wanted = stem(path), parts = wanted.split('/');
  for (let length = 1; length <= parts.length; length++) {
    const suffix = parts.slice(-length).join('/');
    const matches = paths.filter(candidate => compare(stem(candidate)) === compare(suffix) || compare(stem(candidate)).endsWith('/' + compare(suffix)));
    if (matches.length === 1) return /\.[^/]+$/.test(suffix) ? suffix + path.slice(wanted.length) : suffix;
  }
  return '/' + path;
}
