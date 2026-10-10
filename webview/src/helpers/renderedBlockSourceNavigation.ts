import { type EditorView, type KeyBinding } from '@codemirror/view';

/** Hand a boundary arrow back to the document without losing its source range. */
export function renderedBlockSourceBoundaryKeys(input: {
  outerView: EditorView;
  bounds(): { anchor: number; contentTo: number };
  selection(): { anchor: number; head: number };
  releaseProjection(): void;
}): KeyBinding[] {
  const leave = (view: EditorView, forward: boolean, vertical: boolean, extend: boolean) => {
    const selection = view.state.selection.main;
    if (!extend && !selection.empty) return false;
    const edge = forward ? view.state.doc.length : 0;
    if (vertical) {
      const caret = view.coordsAtPos(selection.head), boundary = view.coordsAtPos(edge);
      // A wrapped first/last logical line still has multiple visual rows.
      if (!caret || !boundary || Math.abs(caret.top - boundary.top) > 1) return false;
    } else if (selection.head !== edge) {
      return false;
    }
    const outer = input.outerView;
    const bounds = input.bounds();
    const line = forward
      ? outer.state.doc.line(Math.min(outer.state.doc.lines, outer.state.doc.lineAt(bounds.contentTo).number + 1))
      : outer.state.doc.lineAt(bounds.anchor);
    const column = selection.head - view.state.doc.lineAt(selection.head).from;
    const head = vertical ? line.from + Math.min(column, line.length) : forward ? line.from : line.to;
    const anchor = extend ? input.selection().anchor : head;
    input.releaseProjection();
    outer.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    // Raw DOM focus can expose a stale native range to DOMObserver and undo
    // this handoff. CodeMirror focus synchronizes it without scrolling.
    outer.focus();
    return true;
  };
  const boundaries: Array<[string, boolean, boolean]> = [
    ['ArrowUp', false, true], ['ArrowDown', true, true],
    ['ArrowLeft', false, false], ['ArrowRight', true, false]
  ];
  return boundaries.map(([key, forward, vertical]) => ({
    key,
    run: view => leave(view, forward, vertical, false),
    shift: view => leave(view, forward, vertical, true)
  }));
}
