import type { EditorView } from '@codemirror/view';
import { commitObservedEditorSize } from './layoutMeasurement';

export type ProjectedLineNumberRows = {
  rows: readonly { key: string; label: string; top: number; height: number }[];
  elements: readonly Element[];
  mutations: readonly Element[];
};

/**
 * Project visible source rows into a native gutter. Callers only map source to
 * mounted content; this module owns measurement, keyed writes and cleanup.
 * Resize delivery finishes before paint. Other invalidations join CodeMirror's
 * measurement cycle, without a fixed number of correction frames.
 */
export function mountProjectedLineNumbers(
  view: EditorView,
  column: HTMLElement,
  markerClass: string,
  read: () => ProjectedLineNumberRows | null
): () => void {
  let disposed = false;
  let elements: readonly Element[] = [];
  let mutationTargets: readonly Element[] = [];
  const markers = new Map<string, HTMLElement>();
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (disposed || !column.isConnected) return;
    schedule();
    commitObservedEditorSize(view);
  });
  const mutationObserver = new MutationObserver(() => schedule());
  const gutterPositionObserver = new MutationObserver(() => {
    if (disposed || !column.isConnected) return;
    schedule();
    // CodeMirror's own measurement can move the native gutter after our read.
    // Finish the corrected projection in this microtask, before the next paint.
    commitObservedEditorSize(view);
  });
  // Observe only the mount until the adapter supplies its narrower targets.
  mutationObserver.observe(view.contentDOM, { childList: true, subtree: true });
  const sameElements = (left: readonly Element[], right: readonly Element[]) =>
    left.length === right.length && left.every((element, index) => element === right[index]);

  function schedule(): void {
    if (disposed || !column.isConnected) return;
    view.requestMeasure({
      key: column,
      read: () => !disposed && column.isConnected ? read() : null,
      write(snapshot) {
        if (disposed || !column.isConnected || !snapshot) return;
        const visible = new Set<string>();
        for (const row of snapshot.rows) {
          visible.add(row.key);
          let marker = markers.get(row.key);
          if (!marker) {
            marker = column.ownerDocument.createElement('span');
            marker.className = markerClass;
            markers.set(row.key, marker);
            column.appendChild(marker);
          }
          if (marker.textContent !== row.label) marker.textContent = row.label;
          const top = `${row.top}px`, height = `${row.height}px`;
          if (marker.style.top !== top) marker.style.top = top;
          if (marker.style.height !== height) marker.style.height = height;
        }
        for (const [key, marker] of markers) {
          if (!visible.has(key)) { marker.remove(); markers.delete(key); }
        }
        if (!sameElements(elements, snapshot.elements)) {
          resizeObserver?.disconnect();
          elements = snapshot.elements;
          for (const element of elements) resizeObserver?.observe(element);
        }
        if (!sameElements(mutationTargets, snapshot.mutations)) {
          mutationObserver.disconnect();
          mutationTargets = snapshot.mutations;
          for (const element of mutationTargets) mutationObserver.observe(element,
            { childList: true, characterData: true, subtree: true });
        }
      }
    });
  }
  // toDOM runs before the gutter column is attached. The microtask sees the
  // complete editor transaction. Publish before its first paint as well as
  // after resize: waiting for a later frame briefly leaves the column empty.
  queueMicrotask(() => {
    if (disposed || !column.isConnected) return;
    const gutterRow = column.parentElement;
    if (gutterRow?.matches('.cm-gutterElement')) gutterPositionObserver.observe(gutterRow,
      { attributes: true, attributeFilter: ['style'] });
    schedule();
    commitObservedEditorSize(view);
  });
  view.scrollDOM.addEventListener('scroll', schedule, { passive: true });
  return () => {
    disposed = true;
    resizeObserver?.disconnect();
    mutationObserver.disconnect();
    gutterPositionObserver.disconnect();
    view.scrollDOM.removeEventListener('scroll', schedule);
    markers.clear();
    elements = mutationTargets = [];
  };
}
