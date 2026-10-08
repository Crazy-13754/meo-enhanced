import type { MarkdownConfig } from '@lezer/markdown';
import { matchInlineHtmlCode } from '../../../src/shared/htmlPolicy';
import { parseLatexMathAt } from './math';

/** Consume complete literal spans before their contents reach the delimiter stack.
 * Earlier Escape/InlineCode and the native link parser still own their scopes. */
export const markdownLiteralSyntaxExtension: MarkdownConfig = {
  defineNodes: ['InlineMath', 'InlineHTMLCode'],
  parseInline: [{
    name: 'MarkdownLiteral', before: 'HTMLTag',
    parse(context, next, pos) {
      const from = pos - context.offset;
      if (next === 36) {
        const math = parseLatexMathAt(context.text, from);
        return math ? context.addElement(context.elt('InlineMath', pos, math.to + context.offset)) : -1;
      }
      if (next !== 60) return -1;
      const code = matchInlineHtmlCode(context.text, from);
      if (!code) return -1;
      const contentFrom = code.contentFrom + context.offset, contentTo = code.contentTo + context.offset;
      const to = code.to + context.offset;
      return context.addElement(context.elt('InlineHTMLCode', pos, to, [
        context.elt('HTMLTag', pos, contentFrom),
        context.elt('CodeText', contentFrom, contentTo),
        context.elt('HTMLTag', contentTo, to)
      ]));
    }
  }]
};
