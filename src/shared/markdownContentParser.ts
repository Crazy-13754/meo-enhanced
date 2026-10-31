import MarkdownIt from 'markdown-it';
import { installHighlightTransform } from './markdownHighlight';
import { installInlineScriptTransform } from './markdownInlineScript';
import { installPunctuationInlineTransform } from './markdownPunctuation';
import { matchInlineHtmlCode } from './htmlPolicy';
import { orderedListInterruptsParagraph } from './markdownContentRules';

/** Reading adapters add resources/source maps/sanitization, never another copy
 * of ordinary Markdown/HTML inline grammar. GitHub remains an explicit dialect. */
export function createMarkdownContentParser(github = false): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: !github, langPrefix: 'language-' });
  md.inline.ruler.before('backticks', 'meo_code_space_literal', (state, silent) => {
    if (state.src[state.pos] !== '`') return false;
    const match = /^(`+)([ \n]+)\1(?!`)/.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (!silent) {
      const inlineCode = state.push('code_inline', 'code', 0);
      inlineCode.markup = match[1];
      inlineCode.content = match[2].replace(/\n/g, ' ');
    }
    state.pos += match[0].length;
    return true;
  });
  if (github) return md;
  installHighlightTransform(md);
  installInlineScriptTransform(md);
  installPunctuationInlineTransform(md);
  md.inline.ruler.before('html_inline', 'meo_literal_html_code', (state, silent) => {
    const match = matchInlineHtmlCode(state.src, state.pos, state.posMax);
    if (!match) return false;
    if (!silent) state.push('html_inline', '', 0).content = state.src.slice(state.pos, match.to);
    state.pos = match.to;
    return true;
  });
  md.block.ruler.before('list', 'meo_ordered_container_boundary', (state, line, _end, silent) => {
    if (!silent || state.sCount[line] - state.blkIndent >= 4) return false;
    const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    return orderedListInterruptsParagraph(text, state.parentType !== 'paragraph' || Boolean(state.env?.meoTableCell));
  }, { alt: ['paragraph', 'blockquote'] });
  return md;
}
