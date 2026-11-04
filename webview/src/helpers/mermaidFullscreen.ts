import { mountStaticSvgCanvas } from './staticSvgCanvas';
import { openGraphFullscreen, type GraphFullscreenExitCause } from './graphFullscreen';
import type { UiLanguage } from '../application/uiLanguage';

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
  let updateSvg: (svg: string) => void;
  const modal = openGraphFullscreen({
    language: options.uiLanguage, pointerDriven: options.pointerDriven,
    decorate: options.decorate, onClose: options.onClose,
    mount(container) {
      const canvas = mountStaticSvgCanvas(container, options.svg); updateSvg = canvas.update;
      return canvas;
    }
  });
  return { update(svg) { updateSvg(svg); }, refreshTheme() { modal.refresh(options.uiLanguage); }, close: modal.close };
}
