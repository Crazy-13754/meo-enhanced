import type { DocumentBlockContext, DocumentSvgAppearance, DocumentSvgRenderer, DocumentViewInstance } from '../../../src/documentViews';
import { mountStaticSvgCanvas } from './staticSvgCanvas';

/** Static renderers supply inert SVG; the editor owns sizing, gestures and controls. */
export function mountSvgDocumentBlock(container: HTMLElement, context: DocumentBlockContext, renderer: DocumentSvgRenderer) {
  container.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;user-select:none';
  const camera = mountStaticSvgCanvas(container, '', { interactive: context.interactive,
    camera: context.camera,
    wheel: context.interactive && context.presentation === 'fullscreen',
    maxScale: context.presentation === 'inline' ? 1 : undefined, viewport: context.getAvailableViewport });
  let disposed = false, revision = 0, language = context.language, appearanceKey = '', renderedText: string | undefined;
  const key = (value: DocumentSvgAppearance) => JSON.stringify({ ...value, language: '' });
  const appearance = (): DocumentSvgAppearance => {
    const style = container.ownerDocument.defaultView!.getComputedStyle(container);
    const probe = container.ownerDocument.createElement('span');
    probe.style.color = 'var(--meo-view-background)'; container.append(probe);
    const background = container.ownerDocument.defaultView!.getComputedStyle(probe).color; probe.remove();
    const numbers = background.match(/[\d.]+/g)?.map(Number) ?? [];
    return { language, background, foreground: style.getPropertyValue('--meo-view-foreground').trim(),
      fontFamily: style.getPropertyValue('--meo-view-font-family').trim(),
      fontSize: parseFloat(style.getPropertyValue('--meo-view-font-size')) || 16,
      dark: numbers.length >= 3 && numbers[0]! * .2126 + numbers[1]! * .7152 + numbers[2]! * .0722 < 140 };
  };
  const instance: DocumentViewInstance = {
    setLanguage(next) { language = next; },
    actions: [
      { id: 'zoom-in', label: 'Zoom in', iconPaths: [], run: camera.zoomIn },
      { id: 'zoom-out', label: 'Zoom out', iconPaths: [], run: camera.zoomOut },
      { id: 'fit', label: 'Fit', iconPaths: [], run: camera.fit }
    ],
    async update(snapshot) {
      const current = ++revision, options = appearance(); appearanceKey = key(options);
      const text = await renderer.render(snapshot, options);
      if (disposed || current !== revision) return;
      const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Invalid SVG result');
      const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      const width = viewBox?.[2] ?? parseFloat(svg.getAttribute('width') ?? '');
      const height = viewBox?.[3] ?? parseFloat(svg.getAttribute('height') ?? '');
      if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) throw new Error('Invalid SVG dimensions');
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      svg.setAttribute('style', `display:block;max-width:none;width:${width}px;height:${height}px;pointer-events:none`);
      context.reportContentSize?.({ width: width!, height: height! });
      camera.update(svg.outerHTML, renderedText !== snapshot.text); renderedText = snapshot.text;
    },
    dispose() { disposed = true; revision++; camera.dispose(); renderer.dispose(); }
  };
  return { instance, appearanceChanged: () => appearanceKey !== key(appearance()) };
}
