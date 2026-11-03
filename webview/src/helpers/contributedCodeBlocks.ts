import { Facet, type ChangeDesc, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DocumentBlocksPort } from '../editor/documentBlocks';
import { getFencedCodeInfo } from './markdownSyntax';
import { getFencedCodeContent } from './mermaidDiagram';
import { applyLiveBlockIndent, getLiveBlockIndent, type LiveBlockIndentValue } from './blockIndent';
import { renderedBlockPreview, renderedBlockPreviewHeight, RenderedBlockPreviewHeight } from './renderedBlockPreview';
import { mapLiveWidgetPositions } from '../editor/liveWidgetPositions';

export const documentBlocksFacet = Facet.define<DocumentBlocksPort, DocumentBlocksPort | undefined>({ combine: values => values.at(-1) });

class ContributedCodeWidget extends WidgetType {
  readonly [renderedBlockPreview] = true;
  readonly [renderedBlockPreviewHeight]: RenderedBlockPreviewHeight;
  private mounted?: { dispose(): void };
  [mapLiveWidgetPositions](changes: ChangeDesc, state: EditorState): WidgetType {
    const from = changes.mapPos(this.from, 1), to = changes.mapPos(this.to, -1);
    return from === this.from && to === this.to ? this : new ContributedCodeWidget(this.port, this.language, this.text,
      from, to, state.doc.lineAt(from).number, this.indent);
  }
  constructor(readonly port: DocumentBlocksPort, readonly language: string, readonly text: string,
    readonly from: number, readonly to: number, readonly line: number, readonly indent: LiveBlockIndentValue) {
    super(); this[renderedBlockPreviewHeight] = new RenderedBlockPreviewHeight(language + text);
  }
  eq(other: ContributedCodeWidget) { return this.port === other.port && this.text === other.text && this.language === other.language && this.from === other.from && this.to === other.to; }
  get estimatedHeight() { return this[renderedBlockPreviewHeight].height > 0 ? this[renderedBlockPreviewHeight].height : 360; }
  toDOM(view: EditorView) {
    const shell = document.createElement('div'); shell.className = 'meo-rendered-block-preview';
    shell.dataset.meoRenderedBlockKind = 'contributed'; shell.dataset.meoRenderedBlockStartLine = String(this.line);
    shell.dataset.meoRenderedBlockEndLine = String(view.state.doc.lineAt(this.to).number);
    applyLiveBlockIndent(shell, this.indent);
    this.mounted = this.port.mount(shell, { language: this.language, text: this.text, line: this.line }, () => {
      view.dispatch({ selection: { anchor: Math.min(this.to, view.state.doc.line(this.line + 1).from) }, scrollIntoView: true }); view.focus();
    });
    this[renderedBlockPreviewHeight].observe(shell, view);
    return shell;
  }
  destroy(dom: HTMLElement) { this.mounted?.dispose(); this[renderedBlockPreviewHeight].destroy(dom); }
  ignoreEvent() { return true; }
}

/** Native source while the caret is inside; static result when reading. Source mode is unchanged. */
export function addContributedCodeBlock(builder: any[], state: EditorState, node: any): boolean {
  const port = state.facet(documentBlocksFacet), language = (getFencedCodeInfo(state, node) ?? '').split(/\s+/)[0].toLowerCase();
  if (!port?.supports(language)) return false;
  const start = state.doc.lineAt(node.from), end = state.doc.lineAt(Math.max(node.from, node.to - 1));
  if (end.number < start.number + 2 || state.selection.ranges.some(range => range.from <= end.to && range.to >= start.from)) return false;
  const text = getFencedCodeContent(state, node);
  builder.push(Decoration.replace({ widget: new ContributedCodeWidget(port, language, text, start.from, end.to,
    start.number, getLiveBlockIndent(state, node.from, node.node)), block: true, inclusive: true }).range(start.from, end.to));
  return true;
}
