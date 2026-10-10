import MarkdownIt from 'markdown-it';
import { parseLatexMathAt, renderLatexMathToHtml, type LatexMathMode } from './math';

function mathSourceAttribute(content: string, mode: LatexMathMode): string {
  // KaTeX's display HTML does not retain the expression needed by Preview copy.
  return mode === 'display' ? ` data-source-b64="${Buffer.from(content, 'utf8').toString('base64')}"` : '';
}

export function installMathTransform(
  md: MarkdownIt,
  options: {
    onRenderedMath?: () => void;
    githubStyle?: boolean;
  } = {}
): void {
  const lookingAhead = new WeakSet<object>();
  const excludedByState = new WeakMap<object, Map<string, { from: number; to: number }[]>>();
  const listInlineTokens = new WeakSet<object>();
  if (options.githubStyle) {
    // Inline state has no block ancestry; retain the list context of its token array.
    md.core.ruler.before('inline', 'meo-github-math-context', (state) => {
      let listDepth = 0;
      for (const token of state.tokens) {
        if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') listDepth += 1;
        if (token.type === 'inline' && listDepth > 0 && token.children) listInlineTokens.add(token.children);
        if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') listDepth -= 1;
      }
    });
  }
  // Consume a complete formula before Markdown can reinterpret TeX carets, tildes or escapes.
  // Code, autolinks and literal scripts are consumed by their own enclosing rules.
  md.inline.ruler.before('strikethrough', 'meo_math_inline', (state, silent) => {
    if (lookingAhead.has(state) || state.src[state.pos] !== '$') return false;
    if (options.githubStyle && (state.env?.meoGithubFootnote
      || (state.pos > 0 && !/\s/.test(state.src[state.pos - 1])))) return false;
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
    if (options.githubStyle && math.mode === 'display' && listInlineTokens.has(state.tokens)) return false;
    if (options.githubStyle && /\n[ \t]*\n/.test(math.raw)) return false;
    if (!silent) {
      const html = renderLatexMathToHtml(math.content, math.mode);
      if (!html) return false;
      const node = state.push('html_inline', '', 0);
      node.meta = { meoTrustedHtml: true, meoMathSource: math.raw };
      node.content = `<span class="meo-export-math meo-export-math-${math.mode}"${mathSourceAttribute(math.content, math.mode)}>${html}</span>`;
      options.onRenderedMath?.();
    }
    state.pos = math.to;
    return true;
  });

  md.block.ruler.before('fence', 'meo-math-block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    if (options.githubStyle && (state.env?.meoGithubFootnote || state.listIndent >= 0)) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const end = state.eMarks[startLine];
    if (state.src.slice(start, end).trim() !== '$$') {
      return false;
    }

    for (let line = startLine + 1; line < endLine; line += 1) {
      const lineStart = state.bMarks[line] + state.tShift[line];
      const lineEnd = state.eMarks[line];
      if (options.githubStyle && !state.src.slice(lineStart, lineEnd).trim()) return false;
      if (state.src.slice(lineStart, lineEnd).trim() !== '$$') {
        continue;
      }
      if (silent) {
        return true;
      }

      const content = state.getLines(startLine + 1, line, state.blkIndent, false).trim();
      if (!content) {
        return false;
      }
      const mathBlock = state.push('meo_math_block', 'div', 0);
      mathBlock.block = true;
      mathBlock.content = content;
      mathBlock.map = [startLine, line + 1];
      mathBlock.markup = '$$';
      state.line = line + 1;
      return true;
    }

    return false;
  });

  md.renderer.rules.meo_math_block = (tokens, idx, _options, _env, self) => {
    const mathBlock = tokens[idx];
    const renderedMath = renderLatexMathToHtml(String(mathBlock.content ?? ''), 'display');
    if (!renderedMath) {
      return `<pre>${md.utils.escapeHtml(`$$\n${mathBlock.content}\n$$`)}</pre>\n`;
    }
    options.onRenderedMath?.();
    return `<div class="meo-export-math meo-export-math-display meo-export-math-fenced-display"${mathSourceAttribute(String(mathBlock.content ?? ''), 'display')}${self.renderAttrs(mathBlock)}>${renderedMath}</div>\n`;
  };
}
