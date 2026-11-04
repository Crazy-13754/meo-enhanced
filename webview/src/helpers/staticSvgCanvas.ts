import { mountGraphCanvasPointer } from './graphCanvasPointer';
import { stepVisualZoom, visualZoomPanAtPoint } from './visualZoom';
import type { DocumentBlockCamera } from '../../../src/documentViews';

/** Shared static-SVG camera for Mermaid and contributed graph blocks. */
export function mountStaticSvgCanvas(container: HTMLElement, svgText: string, options: {
  interactive?: boolean; wheel?: boolean; maxScale?: number;
  camera?: DocumentBlockCamera;
  viewport?(): { x: number; y: number; width: number; height: number };
} = {}) {
  const svgWrapper = container.ownerDocument.createElement('div');
  svgWrapper.className = 'meo-mermaid-svg-wrapper'; svgWrapper.innerHTML = svgText;
  svgWrapper.style.flexShrink = '0';
  container.append(svgWrapper);
  let zoom = 1, panX = 0, panY = 0, baseScale = 1;
  let pointerId: number | null = null, lastX = 0, lastY = 0, closed = false;
  const camera = options.camera;
  const dimensions = () => {
    const svg = svgWrapper.querySelector('svg');
    return { width: svg?.width.baseVal.value || svg?.viewBox.baseVal.width || 0,
      height: svg?.height.baseVal.value || svg?.viewBox.baseVal.height || 0 };
  };
  const remember = () => {
    const { width, height } = dimensions(), scale = baseScale * zoom;
    if (camera && width && height) camera.value = { scale, x: width / 2 - panX / scale, y: height / 2 - panY / scale };
  };
  const restore = () => {
    const saved = camera?.value, { width, height } = dimensions();
    if (!saved || !width || !height) return false;
    baseScale = saved.scale; zoom = 1;
    panX = (width / 2 - saved.x) * saved.scale; panY = (height / 2 - saved.y) * saved.scale;
    applyTransform(); return true;
  };
  const events = new AbortController(), signal = events.signal;
  const applyTransform = () => { if (!closed) svgWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${baseScale * zoom})`; };
  const changeZoom = (direction: 1 | -1, pointer?: WheelEvent) => {
    const next = stepVisualZoom(zoom, direction, pointer ? 'wheel' : 'button');
    const bounds = container.getBoundingClientRect();
    const point = pointer ? { x: pointer.clientX, y: pointer.clientY }
      : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    ({ panX, panY } = visualZoomPanAtPoint(svgWrapper, { zoom, panX, panY }, next, point));
    zoom = next; applyTransform(); remember();
  };
  const fit = () => {
    if (closed || !svgWrapper.querySelector('svg')) return;
    if (camera) camera.value = undefined;
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
    lastX = event.clientX; lastY = event.clientY; applyTransform(); remember();
  }, { signal });
  if (options.wheel !== false) container.addEventListener('wheel', event => { event.preventDefault(); changeZoom(event.deltaY > 0 ? -1 : 1, event); }, { signal, passive: false });
  const reflow = () => { if (!closed && !restore()) fit(); };
  const resize = new ResizeObserver(reflow); resize.observe(container); requestAnimationFrame(reflow);
  return { update(svg: string, refit = false) { svgWrapper.innerHTML = svg; if (!restore() && refit) fit(); }, zoomIn: () => changeZoom(1), zoomOut: () => changeZoom(-1), fit,
    dispose() { closed = true; events.abort(); resize.disconnect(); pointer.dispose(); } };
}
