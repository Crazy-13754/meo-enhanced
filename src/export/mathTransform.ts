import MarkdownIt from 'markdown-it';
import { parseLatexMathAt, renderLatexMathToHtml, type LatexMathMode } from './math';
import { mathFenceBodyRange } from '../shared/mathFence';

function mathSourceAttribute(content: string, mode: LatexMathMode): string {
  // KaTeX's display HTML does not retain the expression needed by Preview copy.
  return mode === 'display' ? ` data-source-b64="${Buffer.from(content, 'utf8').toString('base64')}"` : '';
}

export function installMathTransform(
  md: MarkdownIt,
  options: {
    onRenderedMath?: () => void;
  } = {}
): void {
  const lookingAhead = new WeakSet<object>();
  const excludedByState = new WeakMap<object, Map<string, { from: number; to: number }[]>>();
  // Consume a complete formula before Markdown can reinterpret TeX carets, tildes or escapes.
  // Code, autolinks and literal scripts are consumed by their own enclosing rules.
  md.inline.ruler.before('strikethrough', 'meo_math_inline', (state, silent) => {
    if (lookingAhead.has(state) || state.src[state.pos] !== '$') return false;
    let cached = excludedByState.get(state);
    if (!cached) { cached = new Map(); excludedByState.set(state, cached); }
    const scope = `${state.posMax}:${state.level}`;
    let excluded = cached.get(scope);
    if (!excluded) {
      excluded = [];
      const start = state.pos, cache = state.cache;
      lookingAhead.add(state);
      state.cache = {};
      try {
        state.pos += 1;
        while (state.pos < state.posMax) {
          const from = state.pos, char = state.src[from];
          // Validation mode lets native code, HTML and link rules own their scopes.
          // Its cache must not leak into later validation with math enabled.
          md.inline.skipToken(state);
          if ('`<[!'.includes(char!) && state.pos > from + 1) excluded.push({ from, to: state.pos });
        }
      } finally {
        state.pos = start;
        state.cache = cache;
        lookingAhead.delete(state);
      }
      cached.set(scope, excluded);
    }
    const math = parseLatexMathAt(state.src, state.pos, { excludedRanges: excluded.filter(range => range.from > state.pos) });
    if (!math || math.to > state.posMax) return false;
    if (!silent) {
      const html = renderLatexMathToHtml(math.content, math.mode);
      if (!html) return false;
      const node = state.push('html_inline', '', 0);
      node.meta = { meoTrustedHtml: true };
      const source = state.src.slice(math.from, math.to);
      const body = mathFenceBodyRange(source);
      node.content = `<span class="meo-export-math meo-export-math-${math.mode}"${mathSourceAttribute(source.slice(body.from, body.to), math.mode)}>${html}</span>`;
      options.onRenderedMath?.();
    }
    state.pos = math.to;
    return true;
  });

  md.block.ruler.before('fence', 'meo-math-block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const end = state.eMarks[startLine];
    if (state.src.slice(start, end).trim() !== '$$') {
      return false;
    }

    // Markdown-it has already projected list/quote prefixes into bMarks.
    // Scan that scope with the same boundaries used by the editable surface.
    let scopeEnd = Math.min(endLine, state.lineMax);
    for (let line = startLine + 1; line < scopeEnd; line++) {
      if (state.sCount[line] < state.blkIndent && state.src.slice(state.bMarks[line], state.eMarks[line]).trim()) {
        scopeEnd = line;
        break;
      }
    }
    const source = state.getLines(startLine, scopeEnd, state.blkIndent, false);
    const math = parseLatexMathAt(source, source.indexOf('$$'));
    if (!math?.fencedDisplay) return false;
    if (silent) return true;
    const line = startLine + source.slice(0, math.to).split('\n').length - 1;
    const content = math.content;
    const mathBlock = state.push('meo_math_block', 'div', 0);
    mathBlock.block = true;
    mathBlock.content = content;
    const copySource = source.slice(math.from, math.to);
    const body = mathFenceBodyRange(copySource);
    mathBlock.meta = { copySource: copySource.slice(body.from, body.to) };
    mathBlock.map = [startLine, line + 1];
    mathBlock.markup = '$$';
    state.line = line + 1;
    return true;
  });

  md.renderer.rules.meo_math_block = (tokens, idx, _options, _env, self) => {
    const mathBlock = tokens[idx];
    const renderedMath = renderLatexMathToHtml(String(mathBlock.content ?? ''), 'display');
    if (!renderedMath) {
      return `<pre>${md.utils.escapeHtml(`$$\n${mathBlock.content}\n$$`)}</pre>\n`;
    }
    options.onRenderedMath?.();
    return `<div class="meo-export-math meo-export-math-display meo-export-math-fenced-display"${mathSourceAttribute(String(mathBlock.meta?.copySource ?? mathBlock.content ?? ''), 'display')}${self.renderAttrs(mathBlock)}>${renderedMath}</div>\n`;
  };
}
