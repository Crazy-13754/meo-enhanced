import { mountGraphCanvasPointer } from './graphCanvasPointer';
import { stepVisualZoom, visualZoomPanAtPoint } from './visualZoom';

/** Shared static-SVG camera for Mermaid and contributed graph blocks. */
export function mountStaticSvgCanvas(container: HTMLElement, svgText: string, options: {
  interactive?: boolean; wheel?: boolean; maxScale?: number;
  viewport?(): { x: number; y: number; width: number; height: number };
} = {}) {
  const svgWrapper = container.ownerDocument.createElement('div');
  svgWrapper.className = 'meo-mermaid-svg-wrapper'; svgWrapper.innerHTML = svgText;
  svgWrapper.style.flexShrink = '0';
  container.append(svgWrapper);
  let zoom = 1, panX = 0, panY = 0, baseScale = 1;
  let pointerId: number | null = null, lastX = 0, lastY = 0, closed = false;
  const events = new AbortController(), signal = events.signal;
  const applyTransform = () => { if (!closed) svgWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${baseScale * zoom})`; };
  const changeZoom = (direction: 1 | -1, pointer?: WheelEvent) => {
    const next = stepVisualZoom(zoom, direction, pointer ? 'wheel' : 'button');
    const bounds = container.getBoundingClientRect();
    const point = pointer ? { x: pointer.clientX, y: pointer.clientY }
      : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    ({ panX, panY } = visualZoomPanAtPoint(svgWrapper, { zoom, panX, panY }, next, point));
    zoom = next; applyTransform();
  };
  const fit = () => {
    if (closed) return;
    svgWrapper.style.transform = '';
    const svg = svgWrapper.querySelector('svg'), bounds = container.getBoundingClientRect();
    const width = svg?.getBoundingClientRect().width || svg?.viewBox.baseVal.width || 0;
    const height = svg?.getBoundingClientRect().height || svg?.viewBox.baseVal.height || 0;
    const viewport = options.viewport?.() ?? { x: 40, y: 40, width: bounds.width - 80, height: bounds.height - 80 };
    baseScale = width > 0 && height > 0 ? Math.max(0.01, Math.min(options.maxScale ?? Infinity, viewport.width / width, viewport.height / height)) : 1;
    zoom = 1; panX = viewport.x + viewport.width / 2 - bounds.width / 2; panY = viewport.y + viewport.height / 2 - bounds.height / 2; applyTransform();
  };
  const release = () => {
    const pointer = pointerId; pointerId = null;
    if (pointer !== null && container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
  };
  const pointer = mountGraphCanvasPointer(container, { interactive: options.interactive, onEnd: release });
  if (options.interactive !== false) container.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.ctrlKey || (event.target as Element).closest('button, [role="button"]')) return;
    pointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY;
    container.setPointerCapture(pointerId);
  }, { signal });
  container.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId || !pointer.isDragging()) return;
    if (!(event.buttons & 1)) { release(); return; }
    panX += event.clientX - lastX; panY += event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY; applyTransform();
  }, { signal });
  if (options.wheel !== false) container.addEventListener('wheel', event => { event.preventDefault(); changeZoom(event.deltaY > 0 ? -1 : 1, event); }, { signal, passive: false });
  const resize = new ResizeObserver(fit); resize.observe(container); requestAnimationFrame(fit);
  return { update(svg: string, refit = false) { svgWrapper.innerHTML = svg; if (refit) fit(); }, zoomIn: () => changeZoom(1), zoomOut: () => changeZoom(-1), fit,
    dispose() { closed = true; events.abort(); resize.disconnect(); pointer.dispose(); } };
}
