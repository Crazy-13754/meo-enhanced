import type { Input, PartialParse } from '@lezer/common';
import type { LeafBlock, MarkdownConfig } from '@lezer/markdown';
import { markdownContainerHasEnded, orderedListInterruptsParagraph } from '../../../src/shared/markdownContentRules';
import { matchInlineScript } from '../../../src/foundation/inlineScript';

// Preserve native node types/highlight tags while sharing the pure recognizer.
export const inlineScriptMarkdownExtension: MarkdownConfig = {
  parseInline: (['Subscript', 'Superscript'] as const).map(name => ({
    name,
    parse(context, next, pos) {
      if (next !== (name === 'Subscript' ? 126 : 94)) return -1;
      const match = matchInlineScript(context.text, pos - context.offset, context.end - context.offset);
      if (!match) return -1;
      const to = match.to + context.offset, mark = `${name}Mark`;
      return context.addElement(context.elt(name, pos, to, [context.elt(mark, pos, pos + 1),
        ...match.escapes.map(escape => context.elt('Escape', escape.from + context.offset, escape.to + context.offset)),
        context.elt(mark, to - 1, to)]));
    }
  }))
};

/** Adapt the shared container rule through Lezer's public block/wrapper
 * interfaces. Only the current paragraph prefix is inspected; fragments and
 * the existing worker keep their incremental ownership. */
export function createMarkdownContentGrammar(): MarkdownConfig {
  const inputs = new WeakMap<PartialParse, Input>();
  const prefixes = new WeakMap<LeafBlock, { first: string; quotes: number; lists: number }>();
  return {
    wrap(inner, input) { inputs.set(inner, input); return inner; },
    parseBlock: [{
      name: 'ContentContainerBoundary',
      leaf(context, leaf) {
        let quotes = 0, lists = 0;
        for (let depth = 0; depth < context.depth; depth++) {
          const name = context.parentType(depth).name;
          if (name === 'Blockquote') quotes++;
          if (name === 'ListItem') lists++;
        }
        const input = inputs.get(context);
        if (input && (quotes || lists)) prefixes.set(leaf, {
          first: input.read(context.lineStart, leaf.start), quotes, lists
        });
        return null;
      },
      endLeaf(_context, line, leaf) {
        const prefix = prefixes.get(leaf);
        return Boolean(prefix && orderedListInterruptsParagraph(line.text.slice(line.pos),
          markdownContainerHasEnded(prefix.first, line.text.slice(0, line.pos), prefix.quotes, prefix.lists)));
      }
    }]
  };
}
