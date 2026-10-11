import { Prec, RangeSetBuilder, StateEffect, type ChangeDesc } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { activateShikiCodeHighlighting, getShikiTokens, getShikiThemeVersion, requestShikiTokens, subscribeShikiRefresh, type ShikiToken } from './shikiHighlighter';

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
  private tokens: readonly (readonly ShikiToken[])[] | undefined;
  private tokenDocument: EditorView['state']['doc'] | undefined;
  private tokenChanges: ChangeDesc | undefined;

  constructor(view: EditorView) {
    this.inView = view.inView;
    this.release = activateShikiCodeHighlighting('source');
    this.build(view);
    this.unsubscribe = subscribeShikiRefresh(() => view.dispatch({ effects: refreshSourceSyntax.of(null) }), 'source');
  }

  update(update: ViewUpdate): void {
    const becameVisible = !this.inView && update.view.inView;
    this.inView = update.view.inView;
    if (update.docChanged) {
      this.decorations = this.decorations.map(update.changes);
      if (this.tokenDocument) {
        this.tokenChanges = this.tokenChanges?.composeDesc(update.changes) ?? update.changes.desc;
      }
    }
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
      this.tokens = undefined;
      this.tokenDocument = undefined;
      this.tokenChanges = undefined;
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
    } else {
      this.tokens = tokens;
      this.tokenDocument = doc;
      this.tokenChanges = undefined;
    }
    if (!this.tokens || !this.tokenDocument) return;
    // While the latest whole-document tokens are pending, project unchanged
    // ranges from the last completed document into any newly visible viewport.
    // Changed tokens are excluded so stale formatting cannot cover edited text.
    const changes = this.tokenChanges;
    const builder = new RangeSetBuilder<Decoration>();
    // Tokenization retains the full multiline scope stack; only DOM projection
    // is limited to the viewport. Never tokenize a scrolled fragment in isolation.
    const visibleLines = new Set<number>();
    const addLines = (from: number, to: number) => {
      const first = this.tokenDocument!.lineAt(from).number;
      const last = this.tokenDocument!.lineAt(to).number;
      for (let line = first; line <= last; line++) visibleLines.add(line - 1);
    };
    if (changes) {
      // A replacement can map a tiny viewport across the entire old document.
      // Visit only unchanged gaps intersecting the viewport, never deleted text.
      changes.iterGaps((before, after, length) => {
        for (const range of view.visibleRanges) {
          const from = Math.max(range.from, after);
          const to = Math.min(range.to, after + length);
          if (from < to) addLines(before + from - after, before + to - after);
        }
      });
    } else {
      for (const range of view.visibleRanges) addLines(range.from, range.to);
    }
    for (const lineIndex of [...visibleLines].sort((a, b) => a - b)) for (const token of this.tokens[lineIndex] ?? []) {
      const end = token.offset + token.content.length;
      if (changes?.touchesRange(token.offset, end)) continue;
      const from = changes?.mapPos(token.offset, 1) ?? token.offset;
      const to = changes?.mapPos(end, -1) ?? end;
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
