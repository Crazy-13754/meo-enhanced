import { scanLatexMath } from './latexMathScanner';

const mathFenceLanguages = new Set(['math', 'latex', 'tex', 'katex']);

/** These fence aliases all contain TeX rendered by the same formula component. */
export function isMathFenceLanguage(info: string | null | undefined): boolean {
  return mathFenceLanguages.has((info ?? '').trim().split(/\s+/, 1)[0]!.toLowerCase());
}

export function mathFenceContent(source: string): string {
  const text = source.trim();
  const ranges = scanLatexMath(text, { includeEmptyDisplay: true });
  // Accept an optional complete math wrapper; incomplete delimiters remain
  // literal source so editing errors aren't silently repaired during export.
  return ranges.length === 1 && ranges[0]!.from === 0 && ranges[0]!.to === text.length
    ? ranges[0]!.content : text;
}

/** Copy/select omit a complete wrapper, preserving whitespace inside its body.
 * Unlike rendering, these boundaries must not trim intentional source blank lines. */
export function mathFenceBodyRange(source: string): { from: number; to: number } {
  const text = source.trim();
  const ranges = scanLatexMath(text, { includeEmptyDisplay: true });
  const range = ranges[0];
  if (ranges.length !== 1 || !range || range.from !== 0 || range.to !== text.length) {
    return { from: 0, to: source.length };
  }
  const offset = source.length - source.trimStart().length;
  const delimiterLength = range.mode === 'display' ? 2 : 1;
  let from = offset + delimiterLength;
  let to = offset + text.length - delimiterLength;
  if (range.fencedDisplay) {
    from = source.indexOf('\n', from) + 1;
    to = source.lastIndexOf('\n', to - 1);
    if (source[to - 1] === '\r') to--;
  }
  return { from, to: Math.max(from, to) };
}
