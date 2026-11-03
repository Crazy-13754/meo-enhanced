import { createElement, Maximize2, X, ZoomIn, ZoomOut, type IconNode } from 'lucide';
import { ZoomReset } from './zoomResetIcon';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';

/** User-supplied fit-to-canvas artwork, normalized to the shared 24px icon grid. */
export const FitCanvas: IconNode = [['path', {
  transform: 'scale(0.0234375)', fill: 'currentColor', stroke: 'none',
  d: 'M341.333333 832v-21.333333h-85.333333c-23.466667 0-42.666667-19.2-42.666667-42.666667v-85.333333H128v128c0 46.933333 38.4 85.333333 85.333333 85.333333h128v-64zM192 341.333333h21.333333v-85.333333c0-23.466667 19.2-42.666667 42.666667-42.666667h85.333333V128h-128c-46.933333 0-85.333333 38.4-85.333333 85.333333v128h64zM832 682.666667h-21.333333v85.333333c0 23.466667-19.2 42.666667-42.666667 42.666667h-85.333333v85.333333h128c46.933333 0 85.333333-38.4 85.333333-85.333333v-128h-64zM810.666667 128h-128v85.333333h85.333333c23.466667 0 42.666667 19.2 42.666667 42.666667v85.333333h85.333333v-128c0-46.933333-38.4-85.333333-85.333333-85.333333zM298.666667 341.333333v341.333334c0 23.466667 19.2 42.666667 42.666666 42.666666h341.333334c23.466667 0 42.666667-19.2 42.666666-42.666666V341.333333c0-23.466667-19.2-42.666667-42.666666-42.666666H341.333333c-23.466667 0-42.666667 19.2-42.666667 42.666666z m320 298.666667H405.333333c-12.8 0-21.333333-8.533333-21.333333-21.333333V405.333333c0-12.8 8.533333-21.333333 21.333333-21.333333h213.333334c12.8 0 21.333333 8.533333 21.333333 21.333333v213.333334c0 12.8-8.533333 21.333333-21.333333 21.333333z'
}]];

/** Shared visual vocabulary for standard camera actions, including contributed views. */
export function graphCameraIcon(id: string): Parameters<typeof createElement>[0] | undefined {
  return id === 'zoom-in' ? ZoomIn : id === 'zoom-out' ? ZoomOut : id === 'fit' ? ZoomReset : undefined;
}

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
    button.append(doc.importNode(createElement(graphCameraIcon(id) ?? icon, { width: 16, height: 16, 'aria-hidden': 'true' }), true));
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
