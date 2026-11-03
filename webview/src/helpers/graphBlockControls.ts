import { createElement, Maximize2, X, ZoomIn, ZoomOut } from 'lucide';
import { ZoomReset } from './zoomResetIcon';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';

/** Graph gestures belong to one renderer; icons, order and labels belong to the host. */
export function createGraphBlockControls(doc: Document, language: UiLanguage, actions: {
  zoomIn?: () => void; zoomOut?: () => void; fit?: () => void;
  fullscreen?: (pointer: boolean) => void; close?: () => void;
}) {
  const element = doc.createElement('div');
  element.className = 'meo-visual-controls meo-mermaid-zoom-controls';
  element.setAttribute('role', 'group');
  const buttons = new Map<string, HTMLButtonElement>();
  const specs = [
    ['zoom-in', ZoomIn, 'zoomIn', actions.zoomIn], ['zoom-out', ZoomOut, 'zoomOut', actions.zoomOut],
    ['fit', ZoomReset, 'resetZoom', actions.fit], ['fullscreen', Maximize2, 'fullscreen', actions.fullscreen],
    ['close', X, 'exitFullscreen', actions.close]
  ] as const;
  element.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
  for (const [id, icon, , run] of specs) {
    if (!run) continue;
    const button = doc.createElement('button'); button.type = 'button';
    button.className = 'meo-visual-control-btn meo-mermaid-zoom-btn'; button.dataset.action = id;
    if (id === 'fullscreen') button.classList.add('meo-mermaid-fullscreen-btn');
    if (id === 'close') button.classList.add('meo-mermaid-exit-btn');
    button.append(doc.importNode(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' }), true));
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(event.detail > 0); });
    buttons.set(id, button); element.append(button);
  }
  const refresh = (language: UiLanguage) => {
    const strings = getUiStrings(language); element.setAttribute('aria-label', strings.previewTools);
    for (const [id, , label] of specs) {
      const button = buttons.get(id); if (!button) continue;
      button.setAttribute('aria-label', strings[label]); button.dataset.tooltip = strings[label];
    }
  };
  refresh(language);
  return { element, buttons, refresh };
}
