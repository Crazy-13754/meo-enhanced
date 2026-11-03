import { openGraphFullscreen, type GraphFullscreenExitCause } from './graphFullscreen';
import type { UiLanguage } from '../application/uiLanguage';
import { stepVisualZoom, visualZoomPanAtPoint } from './visualZoom';

export type MermaidFullscreenExitCause = GraphFullscreenExitCause;
export type MermaidFullscreenViewer = {
  update(svg: string): void;
  refreshTheme(): void;
  close(cause: MermaidFullscreenExitCause): void;
};

/** Static SVG adapter; the modal and controls are shared with interactive graph renderers. */
export function openMermaidFullscreen(options: {
  svg: string; uiLanguage: UiLanguage; pointerDriven?: boolean;
  decorate?: (element: HTMLElement) => void;
  onClose: (cause: MermaidFullscreenExitCause, pointerDriven: boolean) => void;
}): MermaidFullscreenViewer {
  let wrapper: HTMLElement;
  const modal = openGraphFullscreen({
    language: options.uiLanguage, pointerDriven: options.pointerDriven,
    decorate: options.decorate, onClose: options.onClose,
    mount(container) {
      const svgWrapper = document.createElement('div'); wrapper = svgWrapper;
      svgWrapper.className = 'meo-mermaid-svg-wrapper'; svgWrapper.innerHTML = options.svg;
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
        baseScale = width > 0 && height > 0 ? Math.max(0.01, Math.min((bounds.width - 80) / width, (bounds.height - 80) / height)) : 1;
        zoom = 1; panX = 0; panY = 0; applyTransform();
      };
      const release = () => {
        const pointer = pointerId; pointerId = null;
        if (pointer !== null && container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer);
        container.style.cursor = 'grab';
      };
      container.addEventListener('pointerdown', event => {
        if (event.button !== 0 || (event.target as Element).closest('button, [role="button"]')) return;
        pointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY;
        container.style.cursor = 'grabbing'; container.setPointerCapture(pointerId);
      }, { signal });
      container.addEventListener('pointermove', event => {
        if (event.pointerId !== pointerId) return;
        if (!(event.buttons & 1)) { release(); return; }
        panX += event.clientX - lastX; panY += event.clientY - lastY;
        lastX = event.clientX; lastY = event.clientY; applyTransform();
      }, { signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) container.addEventListener(type, release, { signal });
      window.addEventListener('blur', release, { signal });
      container.addEventListener('wheel', event => { event.preventDefault(); changeZoom(event.deltaY > 0 ? -1 : 1, event); }, { signal, passive: false });
      const resize = new ResizeObserver(fit); resize.observe(container); requestAnimationFrame(fit);
      return { zoomIn: () => changeZoom(1), zoomOut: () => changeZoom(-1), fit,
        dispose() { closed = true; events.abort(); resize.disconnect(); release(); } };
    }
  });
  return { update(svg) { wrapper.innerHTML = svg; }, refreshTheme() { modal.refresh(options.uiLanguage); }, close: modal.close };
}
