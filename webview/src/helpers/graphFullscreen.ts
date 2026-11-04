import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { suppressRenderedBlockPointerFocus } from './renderedBlockActionFocus';
import { createGraphBlockControls } from './graphBlockControls';

export type GraphFullscreenExitCause = 'user-close' | 'escape' | 'dispose' | 'replacement' | 'mode' | 'external' | 'theme';
type Viewer = { close(cause: GraphFullscreenExitCause): void };
let activeViewer: Viewer | null = null;

/** Shared modal lifetime and focus ownership. Camera/pointer handling stays with the renderer. */
export function openGraphFullscreen(options: {
  language: UiLanguage; pointerDriven?: boolean;
  decorate?: (element: HTMLElement) => void;
  onClose(cause: GraphFullscreenExitCause, pointer: boolean): void;
  mount(canvas: HTMLElement): { zoomIn(): void; zoomOut(): void; fit(): void; dispose(): void };
}) {
  activeViewer?.close('replacement');
  const overlay = document.createElement('div'); overlay.className = 'meo-mermaid-fullscreen-scrim';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.tabIndex = -1;
  const container = document.createElement('div'); container.className = 'meo-mermaid-fullscreen';
  const canvas = document.createElement('div'); canvas.className = 'meo-graph-fullscreen-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden';
  let closed = false, pointerDriven = options.pointerDriven ?? false;
  const events = new AbortController();
  const controls = createGraphBlockControls(document, options.language, {
    zoomIn: () => renderer.zoomIn(), zoomOut: () => renderer.zoomOut(), fit: () => renderer.fit(),
    close: () => viewer.close('user-close')
  });
  controls.element.classList.add('meo-mermaid-fullscreen-controls');
  container.append(canvas, controls.element); overlay.append(container); document.body.append(overlay);
  const renderer = options.mount(canvas);
  const viewer = {
    refresh(language: UiLanguage) {
      controls.refresh(language); overlay.setAttribute('aria-label', getUiStrings(language).fullscreen);
      options.decorate?.(container); options.decorate?.(controls.element);
    },
    close(cause: GraphFullscreenExitCause) {
      if (closed) return; closed = true;
      const errors: unknown[] = [];
      for (const dispose of [() => events.abort(), () => renderer.dispose(), () => overlay.remove()]) {
        try { dispose(); } catch (error) { errors.push(error); }
      }
      if (activeViewer === viewer) activeViewer = null;
      try { options.onClose(cause, pointerDriven); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Graph fullscreen cleanup failed');
    }
  };
  activeViewer = viewer; viewer.refresh(options.language);
  overlay.addEventListener('pointerdown', event => {
    if (event.button === 0) { pointerDriven = true; suppressRenderedBlockPointerFocus(overlay); }
  }, { signal: events.signal, capture: true });
  const focusable = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('*')].flatMap(element =>
    element.shadowRoot ? focusable(element.shadowRoot)
      : element.matches('button:not(:disabled),[role="button"][tabindex="0"]') ? [element] : []);
  document.addEventListener('keydown', event => {
    if (['Tab', 'Enter', ' '].includes(event.key)) pointerDriven = false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); viewer.close('escape'); }
    else if (event.key === 'Tab') {
      const buttons = focusable(overlay);
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const current = buttons.indexOf(active as HTMLElement);
      event.preventDefault();
      const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }, { signal: events.signal, capture: true });
  (pointerDriven ? overlay : controls.buttons.get('close')!).focus({ preventScroll: true });
  return viewer;
}
