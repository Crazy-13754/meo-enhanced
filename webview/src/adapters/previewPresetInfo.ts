import { createElement, Info } from 'lucide';
import type { PreviewPresetDefinition } from '../../../src/foundation/previewPresets';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { createTooltip } from './tooltip';

/** Shared author notes and policy explanation for the selector and management list. */
export function createPreviewPresetInfo(className = 'preview-toolbar-action preview-preset-info') {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className;
  element.append(createElement(Info, { width: 15, height: 15, 'aria-hidden': 'true' }));
  const tooltip = createTooltip(element, { content: { kind: 'description', text: '' }, liveUpdate: true });
  return {
    element,
    present(preset: PreviewPresetDefinition, language: UiLanguage, errors: readonly string[] = [], current?: {
      appearance: 'light' | 'dark'; appearancePreference: 'auto' | 'light' | 'dark'; showComments: boolean; sourceColoring: boolean;
    }) {
      const strings = getUiStrings(language);
      const policyText = (key: 'codeColoring' | 'htmlComments') => {
        const policy = preset.controls[key];
        if (policy.mode === 'unsupported') return strings.previewControlUnsupported;
        const mode = policy.mode === 'editable' ? strings.previewControlEditable : strings.previewControlFixed;
        if (policy.mode === 'editable' && !current) return mode;
        const enabled = policy.mode === 'fixed' ? policy.value === true : key === 'codeColoring' ? current!.sourceColoring : current!.showComments;
        return `${mode} · ${key === 'codeColoring' ? enabled ? strings.previewCodeColorsOn : strings.previewCodeColorsOff : enabled ? strings.previewCommentsShow : strings.previewCommentsHide}`;
      };
      element.classList.toggle('has-error', errors.length > 0);
      element.setAttribute('aria-label', `${strings.previewPresetInfo}: ${preset.name[language]}${errors.length ? ` · ${strings.previewPresetError}` : ''}`);
      tooltip.setContent({ kind: 'description',
        text: [preset.description[language], ...preset.notes.map(note => `• ${note[language]}`)].join('\n\n'),
        rows: [
          { label: strings.previewThemeSupport, value: ['light', 'dark'].filter(value => preset.controls.appearance.options?.includes(value)).map(value => value === 'light' ? strings.light : strings.dark).join(' / ') },
          ...(current ? [{ label: strings.previewCurrentTheme, value: `${current.appearance === 'light' ? strings.light : strings.dark}${current.appearancePreference === 'auto' ? ` · ${strings.auto}` : ''}` }] : []),
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
