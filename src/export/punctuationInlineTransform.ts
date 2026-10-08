import type MarkdownIt from 'markdown-it';
import { matchPunctuationClosingInlineStyle } from '../shared/punctuationInlineStyles';
import { collectLatexMathRanges } from './math';

const literalRangeCache = new WeakMap<MarkdownIt.StateInline, Map<number, Array<{ from: number; to: number }>>>();

/** Use the inline parser's validation mode to skip complete literal constructs and link containers.
 * Link labels are parsed separately by markdown-it, so they retain their own styles. */
function literalRanges(state: MarkdownIt.StateInline, from: number): Array<{ from: number; to: number }> {
  const cached = literalRangeCache.get(state)?.get(state.posMax);
  if (cached) return cached;
  const ranges: Array<{ from: number; to: number }> = [];
  const savedPos = state.pos;
  try {
    state.pos = from;
    while (state.pos < state.posMax) {
      const start = state.pos;
      const char = state.src[start];
      if (!char || !'`\\<[!~^$'.includes(char)) { state.pos += 1; continue; }
      state.md.inline.skipToken(state);
      if (state.pos > start + 1) ranges.push({ from: start, to: state.pos });
    }
  } finally { state.pos = savedPos; }
  ranges.push(...collectLatexMathRanges(state.src.slice(from, state.posMax), {
    excludedRanges: ranges.map(range => ({ from: range.from - from, to: range.to - from }))
  }).map(range => ({ from: range.from + from, to: range.to + from })));
  const scopes = literalRangeCache.get(state) ?? new Map();
  scopes.set(state.posMax, ranges);
  literalRangeCache.set(state, scopes);
  return ranges;
}

export function installPunctuationInlineTransform(md: MarkdownIt): void {
  md.inline.ruler.before('strikethrough', 'meo_punctuation_styles', (state, silent) => {
    if (silent || !'*~='.includes(state.src[state.pos] ?? '')) return false;
    const start = state.pos;
    const match = matchPunctuationClosingInlineStyle(state.src, start, state.posMax, literalRanges(state, start + (state.src.startsWith('**', start) || state.src.startsWith('~~', start) || state.src.startsWith('==', start) ? 2 : 1)));
    if (!match) return false;
    const tag = { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's', Highlight: 'mark' }[match.nodeName];
    const end = state.posMax;
    state.push(`${tag}_open`, tag, 1).markup = match.marker;
    state.pos = match.contentFrom;
    state.posMax = match.contentTo;
    state.md.inline.tokenize(state);
    state.push(`${tag}_close`, tag, -1).markup = match.marker;
    state.pos = match.to;
    state.posMax = end;
    return true;
  });
}
