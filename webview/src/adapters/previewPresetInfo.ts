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
      const policyText = (key: 'codeColoring' | 'htmlComments') => {
        const policy = preset.controls[key];
        if (policy.mode === 'unsupported') return strings.previewControlUnsupported;
        if (policy.mode === 'editable') return strings.previewControlEditable;
        const enabled = policy.value === true;
        return `${strings.previewControlFixed} · ${key === 'codeColoring' ? enabled ? strings.previewCodeColorsOn : strings.previewCodeColorsOff : enabled ? strings.previewCommentsShow : strings.previewCommentsHide}`;
      };
      element.classList.toggle('has-error', errors.length > 0);
      if (!menuOption) element.setAttribute('aria-label', `${strings.previewPresetInfo}: ${preset.name[language]}${errors.length ? ` · ${strings.previewPresetError}` : ''}`);
      tooltip.setContent({ kind: 'description',
        text: [preset.description[language], ...preset.notes.map(note => `• ${note[language]}`)].join('\n\n'),
        rows: [
          { label: strings.previewThemeSupport, value: ['light', 'dark'].filter(value => preset.controls.appearance.options?.includes(value)).map(value => value === 'light' ? strings.light : strings.dark).join(' / ') },
          { label: strings.showComments, value: policyText('htmlComments') },
          { label: strings.previewCodeColors, value: policyText('codeColoring') },
          { label: strings.previewFontFamily, value: preset.controls.fontFamily.mode === 'editable' ? strings.previewControlEditable : strings.previewControlStyles },
          { label: strings.previewWidth, value: preset.controls.contentWidth.mode === 'editable' ? strings.previewControlEditable : preset.controls.contentWidth.mode === 'fixed' ? strings.previewControlStyles : strings.previewControlUnsupported }
        ], ...(errors.length ? { error: { title: strings.previewPresetError, text: errors.join('\n\n') } } : {})
      });
    },
    dispose: () => tooltip.dispose()
  };
}
