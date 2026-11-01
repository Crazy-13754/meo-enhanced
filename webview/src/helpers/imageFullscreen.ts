import { createElement, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { suppressRenderedBlockPointerFocus } from './renderedBlockActionFocus';
import { stepVisualZoom, visualZoomPanAtPoint } from './visualZoom';

export type ImageFullscreenViewer = { close(): void };
let activeViewer: ImageFullscreenViewer | null = null;

/** Live and Preview share the outer Webview viewer and an independent viewing camera. */
export function openImageFullscreen(options: {
  src: string;
  alt: string;
  uiLanguage: UiLanguage;
  pointerDriven?: boolean;
  onClose: (userClosed: boolean, pointerDriven: boolean) => void;
}): ImageFullscreenViewer {
  activeViewer?.close();
  const strings = getUiStrings(options.uiLanguage);
  const events = new AbortController();
  const { signal } = events;
  const overlay = document.createElement('div');
  overlay.className = 'meo-md-image-fullscreen-scrim';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', strings.fullscreenImage);
  overlay.tabIndex = -1;
  const container = document.createElement('div');
  container.className = 'meo-md-image-fullscreen';
  const image = document.createElement('img');
  image.className = 'meo-md-image-fullscreen-img';
  image.alt = options.alt;
  image.src = options.src;
  image.draggable = false;
  const controls = document.createElement('div');
  controls.className = 'meo-visual-controls meo-md-image-fullscreen-controls';
  container.append(image, controls);
  overlay.append(container);
  document.body.append(overlay);

  let zoom = 1, panX = 0, panY = 0;
  let pointer: number | null = null;
  let startX = 0, startY = 0, lastX = 0, lastY = 0;
  let dragged = false, closeOnClick = false, closed = false;
  let pointerDriven = options.pointerDriven ?? true;
  const transform = () => { image.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`; };
  const changeZoom = (direction: 1 | -1, wheel?: WheelEvent) => {
    const next = stepVisualZoom(zoom, direction, wheel ? 'wheel' : 'button');
    const bounds = container.getBoundingClientRect();
    const point = wheel ? { x: wheel.clientX, y: wheel.clientY }
      : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    ({ panX, panY } = visualZoomPanAtPoint(image, { zoom, panX, panY }, next, point));
    zoom = next; transform();
  };
  const close = (userClosed: boolean) => {
    if (closed) return;
    closed = true;
    events.abort();
    if (pointer !== null && container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
    overlay.remove();
    if (activeViewer === viewer) activeViewer = null;
    options.onClose(userClosed, pointerDriven);
  };
  const viewer: ImageFullscreenViewer = { close: () => close(false) };
  activeViewer = viewer;
  const button = (icon: typeof ZoomIn, label: string, action: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'meo-visual-control-btn meo-md-image-control-btn';
    element.dataset.tooltip = label;
    element.setAttribute('aria-label', label);
    element.append(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' }));
    element.addEventListener('mousedown', event => event.preventDefault(), { signal });
    element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); }, { signal });
    controls.append(element);
    return element;
  };
  button(ZoomIn, strings.zoomIn, () => changeZoom(1));
  button(ZoomOut, strings.zoomOut, () => changeZoom(-1));
  button(RotateCcw, strings.resetZoom, () => { zoom = 1; panX = 0; panY = 0; transform(); });
  const exit = button(X, strings.exitFullscreen, () => close(true));

  overlay.addEventListener('pointerdown', event => {
    if (event.button === 0) { pointerDriven = true; suppressRenderedBlockPointerFocus(overlay); }
  }, { capture: true, signal });
  container.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    pointer = event.pointerId;
    startX = lastX = event.clientX; startY = lastY = event.clientY;
    dragged = closeOnClick = false;
    container.setPointerCapture(pointer);
    container.classList.add('is-dragging');
  }, { signal });
  container.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId) return;
    if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) dragged = true;
    panX += event.clientX - lastX; panY += event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY; transform();
  }, { signal });
  const release = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    closeOnClick = event.type === 'pointerup' && !dragged;
    if (container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
    pointer = null; container.classList.remove('is-dragging');
  };
  container.addEventListener('pointerup', release, { signal });
  container.addEventListener('pointercancel', release, { signal });
  container.addEventListener('click', event => {
    if (closeOnClick && !(event.target as Element).closest('button')) close(true);
  }, { signal });
  container.addEventListener('wheel', event => { event.preventDefault(); changeZoom(event.deltaY > 0 ? -1 : 1, event); }, { passive: false, signal });
  document.addEventListener('keydown', event => {
    if (['Tab', 'Enter', ' '].includes(event.key)) pointerDriven = false;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = Array.from(controls.querySelectorAll('button'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    }
  }, { capture: true, signal });
  (pointerDriven ? overlay : exit).focus({ preventScroll: true });
  return viewer;
}
