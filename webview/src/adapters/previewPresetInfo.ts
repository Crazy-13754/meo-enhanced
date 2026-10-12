import { createElement, Info } from 'lucide';
import type { PreviewPresetDefinition } from '../../../src/foundation/previewPresets';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { createTooltip } from './tooltip';

/** Pass a menu option for immediate right-side hints, or a class name for an information button. */
export function createPreviewPresetInfo(target: string | HTMLButtonElement = 'preview-toolbar-action preview-preset-info') {
  const menuOption = typeof target !== 'string';
  const element = typeof target === 'string' ? document.createElement('button') : target;
  if (typeof target === 'string') {
    element.type = 'button'; element.className = target;
    element.append(createElement(Info, { width: 15, height: 15, 'aria-hidden': 'true' }));
  }
  const tooltip = createTooltip(element, { content: { kind: 'description', text: '' }, liveUpdate: true,
    ...(menuOption ? { placement: 'right' as const, sideAlign: 'start' as const, immediate: true } : {}) });
  return {
    element,
    present(preset: PreviewPresetDefinition, language: UiLanguage, errors: readonly string[] = []) {
      const strings = getUiStrings(language);
      element.classList.toggle('has-error', errors.length > 0);
      if (!menuOption) element.setAttribute('aria-label', `${strings.previewPresetInfo}: ${preset.name[language]}${errors.length ? ` · ${strings.previewPresetError}` : ''}`);
      tooltip.setContent({ kind: 'description',
        // Older built-in notes remain part of the description, without a separate list.
        text: [preset.description[language], ...preset.notes.map(note => note[language])].join('\n\n'),
        ...(errors.length ? { error: { title: strings.previewPresetError, text: errors.join('\n\n') } } : {})
      });
    },
    dispose: () => tooltip.dispose()
  };
}
