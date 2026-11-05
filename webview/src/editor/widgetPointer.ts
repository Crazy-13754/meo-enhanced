const bindings = new WeakMap<Element, () => void>();

/** A rendered widget activates after a completed click. Movement remains part
 * of the gesture even when the pointer returns to its original position. */
export function bindWidgetClick(root: HTMLElement, activate: (event: MouseEvent) => void): void {
  disposeWidgetClick(root);
  const lifetime = new AbortController();
  const owner = root.ownerDocument.defaultView!;
  let gesture: { id: number; x: number; y: number; dragged: boolean; released: boolean } | null = null;
  let tracking: AbortController | null = null;
  const cancel = () => {
    tracking?.abort();
    tracking = null;
    gesture = null;
  };
  root.addEventListener('pointerdown', event => {
    cancel();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, released: false };
    tracking = new AbortController();
    const options = { capture: true, signal: tracking.signal };
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      if (!(event.buttons & 1)) { cancel(); return; }
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.dragged = true;
    };
    owner.addEventListener('pointermove', move, options);
    owner.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      gesture.dragged ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4;
      gesture.released = true;
      tracking?.abort();
      tracking = null;
    }, options);
    owner.addEventListener('pointercancel', event => {
      if (gesture?.id === event.pointerId) cancel();
    }, options);
    owner.addEventListener('lostpointercapture', event => {
      if (gesture?.id === event.pointerId && !gesture.released) cancel();
    }, options);
    owner.addEventListener('blur', event => { if (event.target === owner) cancel(); }, options);
  }, { signal: lifetime.signal });
  root.addEventListener('click', event => {
    const completed = gesture;
    cancel();
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || event.detail > 0 && (!completed?.released || completed.dragged)) return;
    const selection = root.ownerDocument.getSelection();
    if (event.detail > 0 && selection && !selection.isCollapsed
      && (root.contains(selection.anchorNode) || root.contains(selection.focusNode))) return;
    activate(event);
  }, { signal: lifetime.signal });
  bindings.set(root, () => { cancel(); lifetime.abort(); });
}

export function disposeWidgetClick(root: Element): void {
  bindings.get(root)?.();
  bindings.delete(root);
}
