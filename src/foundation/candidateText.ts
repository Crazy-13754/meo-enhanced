const normalize = (text: string) => text.normalize('NFC').toLowerCase();

/** Prefer exact words and compact matches; query characters retain their order. */
export function candidateTextMatch(text: string, query: string): { rank: number; positions: number[] } | null {
  const value = normalize(text), wanted = normalize(query);
  if (!wanted) return { rank: 0, positions: [] };
  const start = value.indexOf(wanted);
  if (start >= 0) {
    const boundary = start > 0 && (/[^\p{L}\p{N}]/u.test(text[start - 1]) || /[a-z]/.test(text[start - 1]) && /[A-Z]/.test(text[start]));
    return { rank: value === wanted ? 0 : start === 0 ? 100 : boundary ? 200 : 300,
      positions: Array.from({ length: wanted.length }, (_, index) => start + index) };
  }
  const positions: number[] = [];
  let cursor = 0;
  for (const character of wanted) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return null;
    for (let offset = 0; offset < character.length; offset++) positions.push(found + offset);
    cursor = found + character.length;
  }
  return { rank: 400 + Math.min(80, positions.at(-1)! - positions[0] - wanted.length + 1), positions };
}

export function candidateMatchPositions(text: string, query: string): readonly number[] {
  if (normalize(text).length !== text.length) return [];
  return [...new Set(query.trim().split(/\s+/).flatMap(term => candidateTextMatch(text, term)?.positions ?? []))].sort((a, b) => a - b);
}
