/** Shared canvas feedback; renderers keep ownership of their pan/zoom engines. */
export function mountGraphCanvasPointer(container: HTMLElement, options: {
  interactive?: boolean;
  onEnd?(): void;
} = {}) {
  const doc = container.ownerDocument, win = doc.defaultView!;
  const root = container.getRootNode();
  const sheet = doc.createElement('style');
  sheet.textContent = `
    [data-meo-graph-canvas]{cursor:var(--meo-graph-drag-cursor,default)}
    [data-meo-graph-canvas] svg,[data-meo-graph-canvas] svg *{
      cursor:var(--meo-graph-drag-cursor,var(--meo-graph-node-cursor,default))!important
    }
    [data-meo-graph-canvas] [data-meo-graph-action]{--meo-graph-node-cursor:pointer}
    [data-meo-graph-canvas] button svg,[data-meo-graph-canvas] button svg *{cursor:inherit!important}
  `;
  // Detached Live widgets will join their owner document; contributed blocks
  // already have a shadow root, which must own its own copy of the rules.
  (root.nodeType === 11 ? root : doc.head).appendChild(sheet);
  container.setAttribute('data-meo-graph-canvas', '');
  const events = new AbortController(), signal = events.signal;
  let start: { id: number; x: number; y: number } | undefined;
  let dragging = false;
  const reset = () => {
    const active = !!start;
    start = undefined; dragging = false;
    container.style.removeProperty('--meo-graph-drag-cursor');
    container.classList.remove('meo-mermaid-dragging');
    if (active) options.onEnd?.();
  };
  if (options.interactive !== false) {
    container.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.ctrlKey || event.composedPath().some(target =>
        target instanceof win.Element && target.matches('button, .meo-mermaid-zoom-controls'))) return;
      reset(); start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { capture: true, signal });
    win.addEventListener('pointermove', event => {
      if (!start || event.pointerId !== start.id) return;
      if (!(event.buttons & 1)) { reset(); return; }
      if (!dragging && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
        dragging = true;
        container.style.setProperty('--meo-graph-drag-cursor', 'grabbing');
        container.classList.add('meo-mermaid-dragging');
      }
    }, { capture: true, signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      win.addEventListener(type, event => { if (start?.id === event.pointerId) reset(); }, { capture: true, signal });
    }
    win.addEventListener('blur', reset, { signal });
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) reset(); }, { signal });
  }
  return { isDragging: () => dragging, reset, dispose() {
    reset(); events.abort(); sheet.remove(); container.removeAttribute('data-meo-graph-canvas');
  } };
}
