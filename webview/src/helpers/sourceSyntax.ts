import { Prec, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { activateShikiCodeHighlighting, getShikiTokens, getShikiThemeVersion, requestShikiTokens, subscribeShikiRefresh } from './shikiHighlighter';

const refreshSourceSyntax = StateEffect.define<null>();

/** Markdown uses TextMate's scope stack, including punctuation and embedded grammars.
 * Source owns this runtime so user token customizations cannot recolor Live or Preview.
 */
export const sourceSyntax = Prec.highest(ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;
  private destroyed = false;
  private readonly release: () => void;
  private readonly unsubscribe: () => void;
  private readonly marks = new Map<string, Decoration>();
  private generation = -1;
  private document: EditorView['state']['doc'] | undefined;
  private text = '';
  private inView: boolean;

  constructor(view: EditorView) {
    this.inView = view.inView;
    this.release = activateShikiCodeHighlighting('source');
    this.build(view);
    this.unsubscribe = subscribeShikiRefresh(() => view.dispatch({ effects: refreshSourceSyntax.of(null) }), 'source');
  }

  update(update: ViewUpdate): void {
    const becameVisible = !this.inView && update.view.inView;
    this.inView = update.view.inView;
    if (update.docChanged) this.decorations = this.decorations.map(update.changes);
    if (update.docChanged || update.viewportChanged || becameVisible || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshSourceSyntax)))) {
      this.build(update.view);
    }
  }

  private build(view: EditorView): void {
    const generation = getShikiThemeVersion('source');
    if (generation !== this.generation) {
      this.generation = generation;
      this.marks.clear();
      this.decorations = Decoration.none;
    }
    if (this.document !== view.state.doc) {
      this.document = view.state.doc;
      this.text = view.state.doc.toString();
    }
    const doc = this.document;
    // Hidden revisions supersede pending work; tokenize only the latest document on reveal.
    if (!view.inView) return;
    const tokens = getShikiTokens('markdown', this.text, 'source');
    if (!tokens) {
      requestShikiTokens('markdown', this.text, 'source', () => !this.destroyed && view.inView && this.document === doc);
      return;
    }
    const builder = new RangeSetBuilder<Decoration>();
    // Tokenization retains the full multiline scope stack; only DOM projection
    // is limited to the viewport. Never tokenize a scrolled fragment in isolation.
    const visibleLines = new Set<number>();
    for (const range of view.visibleRanges) {
      const last = view.state.doc.lineAt(range.to).number;
      for (let line = view.state.doc.lineAt(range.from).number; line <= last; line++) visibleLines.add(line - 1);
    }
    for (const lineIndex of [...visibleLines].sort((a, b) => a - b)) for (const token of tokens[lineIndex] ?? []) {
      const from = token.offset;
      const to = from + token.content.length;
      if (from >= to || !view.visibleRanges.some(range => from < range.to && to > range.from)) continue;
      const font = token.fontStyle ?? 0;
      const style = `color:${token.color ?? 'var(--meo-source-foreground)'} !important;-webkit-text-fill-color:currentColor !important;font-style:${font & 1 ? 'italic' : 'normal'} !important;font-weight:${font & 2 ? '700' : 'var(--meo-font-source-weight)'} !important;text-decoration:${[font & 4 ? 'underline' : '', font & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'} !important`;
      let mark = this.marks.get(style);
      if (!mark) {
        mark = Decoration.mark({ class: 'meo-source-token', attributes: { style } });
        this.marks.set(style, mark);
      }
      builder.add(from, to, mark);
    }
    this.decorations = builder.finish();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.release();
  }
}, { decorations: plugin => plugin.decorations }));
