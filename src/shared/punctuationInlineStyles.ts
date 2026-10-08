/** Longer equals/tilde runs are literal; asterisk runs retain native emphasis nesting. */
export function isExactInlineStyleMarker(text: string, from: number, marker: string): boolean {
  return text.startsWith(marker, from) && text[from - 1] !== marker[0] && text[from + marker.length] !== marker[0];
}

/** Punctuation may touch either side of a style delimiter. Whitespace still prevents
 * opening/closing. Adapters leave pairing, nesting and unmatched markers to their
 * native delimiter resolver, inside the parser's code/link/comment scopes. */
export function inlineStyleDelimiter(text: string, from: number, end = text.length): {
  marker: '*' | '~~' | '=='; length: number; canOpen: boolean; canClose: boolean;
} | null {
  if (from < 0 || from >= end) return null;
  const char = text[from];
  if (char !== '*' && char !== '~' && char !== '=') return null;
  let to = from + 2;
  if (char === '*' || char === '~') {
    if (char === '~' && text[from - 1] === '~') return null;
    to = from + 1;
    while (to < end && text[to] === char) to += 1;
  } else if (to > end || text[from + 1] !== char || text[to] === char) return null;
  const length = to - from;
  if (char === '~' && length === 1) return null;
  if (char === '=' && !isExactInlineStyleMarker(text, from, '==')) return null;
  return {
    marker: char === '*' ? '*' : char === '~' ? '~~' : '==', length,
    canOpen: (char !== '~' || length === 2) && to < end && !/\s/u.test(text[to]!),
    canClose: (char !== '~' || length === 2) && from > 0 && !/\s/u.test(text[from - 1]!)
  };
}
