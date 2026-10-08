export type InlineStyleNodeName = 'StrongEmphasis' | 'Strikethrough' | 'Highlight' | 'Emphasis';

export type ParsedInlineStyleRange = {
  from: number;
  to: number;
  nodeName: InlineStyleNodeName | 'InlineCode';
};

export type FallbackInlineStyleRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  closeFrom: number;
  marker: '**' | '~~' | '==' | '*';
  nodeName: InlineStyleNodeName;
};

type SourceRange = Readonly<{ from: number; to: number }>;
const styles = [
  { marker: '**', nodeName: 'StrongEmphasis' },
  { marker: '~~', nodeName: 'Strikethrough' },
  { marker: '==', nodeName: 'Highlight' },
  { marker: '*', nodeName: 'Emphasis' }
] as const;

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function isPunctuation(char: string): boolean {
  return char !== '' && /[\p{P}\p{S}]/u.test(char);
}

/** A longer run is owned by the native nesting parser, rather than this extension. */
export function isExactInlineStyleMarker(text: string, from: number, marker: string): boolean {
  return text.startsWith(marker, from) && text[from - 1] !== marker[0] && text[from + marker.length] !== marker[0];
}

function findStyle(
  text: string, cursor: number, end: number, baseOffset: number,
  parsed: readonly ParsedInlineStyleRange[], excluded: readonly SourceRange[]
): { range: FallbackInlineStyleRange; needsExtension: boolean } | null {
  const style = styles.find(({ marker }) => text.startsWith(marker, cursor));
  if (!style || isEscaped(text, cursor) || !isExactInlineStyleMarker(text, cursor, style.marker)) return null;
  const from = baseOffset + cursor;
  const inLiteral = (position: number, length: number) => excluded.find(range => position < range.to && position + length > range.from);
  if (inLiteral(from, style.marker.length)) return null;
  const contentFrom = cursor + style.marker.length;
  if (!text[contentFrom] || /\s/u.test(text[contentFrom])) return null;
  const newline = text.indexOf('\n', contentFrom);
  const limit = newline < 0 ? end : Math.min(end, newline);
  let close = text.indexOf(style.marker, contentFrom + 1);
  while (close >= 0 && close + style.marker.length <= limit) {
    const closeFrom = baseOffset + close;
    const literal = inLiteral(closeFrom, style.marker.length);
    if (literal) {
      close = text.indexOf(style.marker, Math.max(close + style.marker.length, literal.to - baseOffset));
      continue;
    }
    if (parsed.some(range => range.nodeName === style.nodeName && closeFrom >= range.from && closeFrom < range.to)) return null;
    const beforeClose = text[close - 1] ?? '';
    if (isExactInlineStyleMarker(text, close, style.marker) && !isEscaped(text, close) && beforeClose && !/\s/u.test(beforeClose)) break;
    close = text.indexOf(style.marker, close + style.marker.length);
  }
  if (close < 0 || close + style.marker.length > limit) return null;
  const beforeOpen = text[cursor - 1] ?? '';
  const afterClose = close + style.marker.length < end ? text[close + style.marker.length] : '';
  return {
    needsExtension: (beforeOpen !== '' && !/\s/u.test(beforeOpen) && isPunctuation(text[contentFrom] ?? ''))
      || (isPunctuation(text[close - 1] ?? '') && afterClose !== '' && !/\s/u.test(afterClose)),
    range: { from, to: baseOffset + close + style.marker.length, contentFrom: baseOffset + contentFrom,
      contentTo: baseOffset + close, closeFrom: baseOffset + close, marker: style.marker, nodeName: style.nodeName }
  };
}

/** Parser adapters provide half-open literal ranges; their delimiters cannot participate in pairing.
 * Outer styles may still contain complete code spans, links or formulas. */
export function matchPunctuationClosingInlineStyle(
  text: string, from: number, end = text.length, excludedRanges: readonly SourceRange[] = []
): FallbackInlineStyleRange | null {
  const match = findStyle(text, from, end, 0, [], excludedRanges);
  return match?.needsExtension ? match.range : null;
}

export function collectPunctuationClosingInlineStyles(
  text: string, baseOffset = 0, parsedStyleRanges: readonly ParsedInlineStyleRange[] = [],
  excludedRanges: readonly SourceRange[] = []
): FallbackInlineStyleRange[] {
  const ranges: FallbackInlineStyleRange[] = [];
  const excluded = [...excludedRanges, ...parsedStyleRanges.filter(range => range.nodeName === 'InlineCode')];
  const candidates = /\*|~~|==/g;
  let cursor = 0;
  while (cursor < text.length) {
    candidates.lastIndex = cursor;
    const candidate = candidates.exec(text);
    if (!candidate) break;
    cursor = candidate.index;
    const style = styles.find(({ marker }) => text.startsWith(marker, cursor))!;
    const from = baseOffset + cursor;
    const container = parsedStyleRanges.find(range => range.nodeName === style.nodeName && from >= range.from && from < range.to);
    const literal = excluded.find(range => from >= range.from && from < range.to);
    if (container || literal) {
      cursor = Math.max(cursor + style.marker.length, (container ?? literal)!.to - baseOffset);
      continue;
    }
    const match = findStyle(text, cursor, text.length, baseOffset, parsedStyleRanges, excluded);
    if (match?.needsExtension) ranges.push(match.range);
    cursor = match ? match.range.to - baseOffset : cursor + style.marker.length;
  }
  return ranges;
}
