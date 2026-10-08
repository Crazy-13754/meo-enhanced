import type { InlineContext, MarkdownConfig, MarkdownParser } from '@lezer/markdown';
import { matchInlineHtmlCode } from '../../../src/shared/htmlPolicy';
import { parseLatexMathAt } from './math';

/** Consume complete literal spans before their contents reach the delimiter stack.
 * Earlier Escape/InlineCode and the native link parser still own their scopes. */
export const htmlCodeLiteralSyntaxExtension: MarkdownConfig = {
  defineNodes: ['InlineHTMLCode'],
  parseInline: [{
    name: 'HTMLCodeLiteral', before: 'HTMLTag',
    parse(context, next, pos) {
      const from = pos - context.offset;
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

/** A harmless prose prefix keeps standalone cell/tag text in an inline scope. */
export function collectInlineMathExcludedRanges(parser: MarkdownParser, text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  parser.parse(`x ${text}`).iterate({ enter(node) {
    if (/^(?:InlineCode|InlineHTMLCode|HTMLTag|Comment|CommentBlock|Autolink|Link|URL|LinkTitle|LinkLabel)$/.test(node.name)) {
      ranges.push({ from: Math.max(0, node.from - 2), to: node.to - 2 });
      if (node.name !== 'Link') return false;
    }
  } });
  return ranges;
}

export function createMathLiteralSyntaxExtension(parser: MarkdownParser): MarkdownConfig {
  const excludedByContext = new WeakMap<InlineContext, { from: number; to: number }[]>();
  return { defineNodes: ['InlineMath', 'InlineMathExcluded'], parseInline: [{
    name: 'MathLiteral', before: 'HTMLCodeLiteral',
    parse(context, next, pos) {
      if (next !== 36) return -1;
      let excluded = excludedByContext.get(context);
      if (!excluded) {
        excluded = collectInlineMathExcludedRanges(parser, context.text);
        excludedByContext.set(context, excluded);
      }
      const from = pos - context.offset;
      const math = parseLatexMathAt(context.text, from, { excludedRanges: excluded.filter(range => range.from > from) });
      return math ? context.addElement(context.elt('InlineMath', pos, math.to + context.offset,
        excluded.filter(range => range.from > from && range.to < math.to).map(range =>
          context.elt('InlineMathExcluded', context.offset + range.from, context.offset + range.to)))) : -1;
    }
  }] };
}
