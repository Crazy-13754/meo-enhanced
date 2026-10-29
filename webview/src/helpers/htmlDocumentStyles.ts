import type { EditorState, Text } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { IterMode, type Tree } from '@lezer/common';
import { inspectHtmlStylesheets } from '../../../src/shared/htmlStylesheet';
import { isCompleteMarkdownStructure, markdownStructureIdentity } from '../editor/markdownStructure';

const cache = new WeakMap<Text, { tree: Tree; css: string }>();

/** Runs in the existing complete-context worker for optimized documents. */
export function collectHtmlDocumentStyles(doc: Text, tree: Tree): string {
  tree = markdownStructureIdentity(tree);
  const previous = cache.get(doc);
  if (previous?.tree === tree) return previous.css;
  const sheets: string[] = [];
  tree.iterate({ mode: IterMode.IgnoreMounts, enter(node) {
    if (node.name !== 'HTMLBlock') return;
    const source = doc.sliceString(node.from, node.to);
    if (/<style\b/i.test(source)) sheets.push(inspectHtmlStylesheets(source).css);
    return false;
  } });
  const css = sheets.filter(Boolean).join('\n');
  cache.set(doc, { tree, css });
  return css;
}

export function adoptHtmlDocumentStyles(doc: Text, tree: Tree, css: string): void {
  cache.set(doc, { tree: markdownStructureIdentity(tree), css });
}

export function readHtmlDocumentStyles(doc: Text, tree: Tree): string | undefined {
  const known = cache.get(doc);
  return known?.tree === markdownStructureIdentity(tree) ? known.css : undefined;
}

/** One stylesheet per Live surface; offscreen/unmounted source blocks do not
 * remove document CSS. The main document remains the only editable source. */
export function createHtmlDocumentStyles(readTree: (state: EditorState) => Tree, usesWorker: (state: EditorState) => boolean) {
  return ViewPlugin.fromClass(class {
    readonly element: HTMLStyleElement;
    constructor(readonly view: EditorView) {
      this.element = view.dom.ownerDocument.createElement('style');
      view.dom.append(this.element);
      this.refresh();
    }
    update(): void { this.refresh(); }
    refresh(): void {
      const doc = this.view.state.doc;
      const tree = readTree(this.view.state);
      const known = cache.get(doc);
      const identity = markdownStructureIdentity(tree);
      const css = known?.tree === identity ? known.css : !usesWorker(this.view.state) && isCompleteMarkdownStructure(tree, doc.length)
        ? collectHtmlDocumentStyles(doc, tree) : undefined;
      if (css !== undefined && this.element.textContent !== css) this.element.textContent = css;
    }
    destroy(): void { this.element.remove(); }
  });
}
