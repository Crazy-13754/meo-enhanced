import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { tags } from '@lezer/highlight';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';
import { currentSyntaxTree, syntaxTreeChanged } from './markdownSyntax';
import { inlineStyleDelimiter } from '../../../src/shared/punctuationInlineStyles';

const HIGHLIGHT_MARKER_CODE = 61;
const highlightDelimiter: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' };

export const highlightMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    'Highlight',
    { name: 'HighlightMark', style: tags.processingInstruction }
  ],
  parseInline: [{
    name: 'Highlight',
    after: 'Emphasis',
    parse(context, next, pos) {
      if (next !== HIGHLIGHT_MARKER_CODE) return -1;
      const delimiter = inlineStyleDelimiter(context.text, pos - context.offset);
      return delimiter ? context.addDelimiter(highlightDelimiter, pos, pos + 2, delimiter.canOpen, delimiter.canClose) : -1;
    }
  }]
};

const sourceHighlightDecoration = Decoration.mark({ class: 'meo-md-highlight' });

function buildSourceHighlightDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  currentSyntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== 'Highlight' || node.to - node.from <= 4) return;
      builder.add(node.from + 2, node.to - 2, sourceHighlightDecoration);
    }
  });
  return builder.finish();
}

export const sourceHighlightField = StateField.define<DecorationSet>({
  create: buildSourceHighlightDecorations,
  update(decorations, transaction) {
    return transaction.docChanged || syntaxTreeChanged(transaction)
      ? buildSourceHighlightDecorations(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});
