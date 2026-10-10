import { darkCssVariableOverrides } from '../themes/editorDarkTheme';
import { lightCssVariableOverrides } from '../themes/editorLightTheme';

export const contentVariable = (name: string): string => name.replace('--vscode-', '--meo-content-');

/** Freeze existing document colors independently of native UI tokens. */
export function contentColor(value: string): string {
  return value.replace(/--vscode-[\w-]+/g, name => name !== '--vscode-editor-background' && name in darkCssVariableOverrides ? contentVariable(name) : name);
}

export function applyUiTheme(appearance: 'light' | 'dark', matchesHost: boolean): void {
  const style = document.documentElement.style;
  const fallback = appearance === 'light' ? lightCssVariableOverrides : darkCssVariableOverrides;
  const color = (id: string, legacy: string): string => matchesHost ? `var(--vscode-${id.replace(/\./g, '-')}, ${legacy})` : legacy;
  const set = (id: string, value: string) => style.setProperty('--meo-ui-' + id, value);
  // Keep native variables untouched. These aliases also prevent an opposite
  // manual appearance from mixing light foregrounds with dark host surfaces.
  for (const [name, value] of Object.entries(fallback)) {
    if (name.startsWith('--vscode-')) set(name.slice(2), color(name.slice(9), value));
  }
  const fg = color('editorWidget.foreground', color('foreground', fallback['--vscode-editor-foreground']!));
  const border = color('contrastBorder', color('widget.border', fallback['--vscode-panel-border']!));
  const surface = color('editorWidget.background', fallback['--vscode-sideBar-background']!);
  set('foreground', fg);
  set('surface', surface);
  set('border', border);
  set('focus', color('focusBorder', appearance === 'light' ? '#0969da' : '#3794ff'));
  set('shadow', matchesHost ? '0 4px 12px var(--vscode-widget-shadow, rgb(0 0 0 / 24%))' : fallback['--meo-elevated-shadow']!);
  set('menu-background', color('menu.background', surface));
  set('menu-foreground', color('menu.foreground', fg));
  set('menu-border', color('menu.border', border));
  set('menu-hover', color('menu.selectionBackground', fallback['--vscode-toolbar-hoverBackground']!));
  set('menu-hover-foreground', color('menu.selectionForeground', fg));
  set('menu-selection-border', color('menu.selectionBorder', color('contrastActiveBorder', 'transparent')));
  set('menu-separator', color('menu.separatorBackground', border));
  set('dropdown-background', color('dropdown.background', fallback['--vscode-input-background']!));
  set('dropdown-list', color('dropdown.listBackground', color('menu.background', surface)));
  set('dropdown-foreground', color('dropdown.foreground', fg));
  set('dropdown-border', color('dropdown.border', border));
  set('input-border', color('input.border', fallback['--meo-input-border']!));
  set('muted', color('descriptionForeground', fallback['--vscode-descriptionForeground']!));
  set('disabled', color('disabledForeground', fallback['--vscode-disabledForeground']!));
  set('button-background', color('button.background', fallback['--meo-notice-action-surface']!));
  set('button-foreground', color('button.foreground', fallback['--meo-notice-action-foreground']!));
  set('button-hover', color('button.hoverBackground', fallback['--meo-notice-action-hover-surface']!));
  set('secondary-foreground', color('button.secondaryForeground', fg));
  set('secondary-hover', color('button.secondaryHoverBackground', fallback['--vscode-toolbar-hoverBackground']!));
  const selected = color('radio.activeBackground', color('inputOption.activeBackground', appearance === 'light' ? '#ffffff' : '#272c30'));
  const selectedFg = color('radio.activeForeground', color('inputOption.activeForeground', fg));
  const selectedBorder = color('radio.activeBorder', color('inputOption.activeBorder', color('contrastActiveBorder', 'transparent')));
  set('selected-background', selected);
  set('selected-foreground', selectedFg);
  set('selected-border', selectedBorder);
  // Native radio tokens can flatten the track into the toolbar. Derive this
  // compact control's surfaces together, without changing other selected UI.
  set('segmented-background', `color-mix(in srgb, ${surface} ${appearance === 'light' ? 90 : 84}%, ${appearance === 'light' ? 'black' : 'white'} ${appearance === 'light' ? 10 : 16}%)`);
  set('segmented-selected-background', appearance === 'light' ? '#ffffff' : `color-mix(in srgb, ${surface} 95%, white 5%)`);
  set('segmented-foreground', `color-mix(in srgb, ${fg} 75%, ${surface} 25%)`);
  set('segmented-selected-border', color('contrastActiveBorder', appearance === 'light' ? 'rgb(0 0 0 / 10%)' : 'rgb(255 255 255 / 8%)'));
  set('suggest-background', color('editorSuggestWidget.background', surface));
  set('suggest-foreground', color('editorSuggestWidget.foreground', fg));
  set('suggest-border', color('editorSuggestWidget.border', border));
  set('suggest-selected', color('editorSuggestWidget.selectedBackground', selected));
  set('suggest-selected-foreground', color('editorSuggestWidget.selectedForeground', selectedFg));
  set('suggest-match', color('editorSuggestWidget.highlightForeground', fallback['--meo-notice-info']!));
  set('suggest-selected-match', color('editorSuggestWidget.focusHighlightForeground', selectedFg));
  set('list-hover', color('list.hoverBackground', fallback['--vscode-toolbar-hoverBackground']!));
  set('list-hover-foreground', color('list.hoverForeground', fg));
  set('list-selected', color('list.activeSelectionBackground', selected));
  set('list-selected-foreground', color('list.activeSelectionForeground', selectedFg));
  set('error', color('errorForeground', fallback['--meo-notice-error']!));
  set('warning', color('editorWarning.foreground', fallback['--meo-notice-warning']!));
  set('scrollbar', color('scrollbarSlider.background', 'rgb(127 127 127 / 40%)'));
  set('scrollbar-hover', color('scrollbarSlider.hoverBackground', 'rgb(127 127 127 / 60%)'));
  set('scrollbar-active', color('scrollbarSlider.activeBackground', 'rgb(127 127 127 / 70%)'));
  set('sash-hover', color('sash.hoverBorder', color('focusBorder', '#316dca')));
  for (const [id, legacy] of Object.entries({
    'focusBorder': appearance === 'light' ? '#0969da' : '#3794ff',
    'input.border': fallback['--meo-input-border'],
    'inputValidation.errorBorder': fallback['--meo-notice-error'],
    'errorForeground': fallback['--meo-notice-error'],
    'textLink.foreground': fallback['--meo-notice-info'],
    'textLink.activeForeground': fallback['--meo-notice-info'],
    'charts.green': appearance === 'light' ? '#1a7f37' : '#73c991',
    'widget.shadow': appearance === 'light' ? 'rgb(31 35 40 / 18%)' : 'rgb(0 0 0 / 36%)'
  })) set('vscode-' + id.replace(/\./g, '-'), color(id, legacy!));
  for (const id of ['font-family', 'editor-font-family']) set('vscode-' + id, `var(--vscode-${id})`);
  set('outline-foreground', color('editor.foreground', fallback['--vscode-editor-foreground']!));
  set('settings-header', color('settings.headerForeground', fg));
  set('settings-input-background', color('settings.textInputBackground', fallback['--vscode-input-background']!));
  set('settings-input-foreground', color('settings.textInputForeground', fallback['--vscode-input-foreground']!));
  set('settings-input-border', color('settings.textInputBorder', fallback['--meo-input-border']!));
  set('switch-background', color('checkbox.background', `color-mix(in srgb, ${fallback['--vscode-editor-foreground']} ${appearance === 'light' ? 18 : 27}%, ${fallback['--vscode-editor-background']})`));
  set('switch-border', color('checkbox.border', 'transparent'));
  set('switch-knob', color('checkbox.foreground', '#ffffff'));
  set('switch-active-background', color('inputOption.activeBackground', appearance === 'light' ? '#3483ff' : '#247bf4'));
  set('switch-active-foreground', color('inputOption.activeForeground', '#ffffff'));
  set('switch-active-border', color('inputOption.activeBorder', 'transparent'));
  set('notice-border', color('notifications.border', border));
  for (const [property, id, legacy] of [
    ['--meo-notice-surface', 'notifications.background', fallback['--meo-notice-surface']],
    ['--meo-notice-foreground', 'notifications.foreground', fallback['--meo-notice-foreground']],
    ['--meo-notice-action-surface', 'button.background', fallback['--meo-notice-action-surface']],
    ['--meo-notice-action-foreground', 'button.foreground', fallback['--meo-notice-action-foreground']],
    ['--meo-notice-action-hover-surface', 'button.hoverBackground', fallback['--meo-notice-action-hover-surface']],
    ['--meo-notice-info', 'editorInfo.foreground', fallback['--meo-notice-info']],
    ['--meo-notice-warning', 'editorWarning.foreground', fallback['--meo-notice-warning']],
    ['--meo-notice-error', 'editorError.foreground', fallback['--meo-notice-error']],
    ['--meo-fixed-baseline-active-background', 'radio.activeBackground', selected],
    ['--meo-fixed-baseline-active-foreground', 'radio.activeForeground', selectedFg],
    ['--meo-fixed-baseline-standby-foreground', 'icon.foreground', fg]
  ] as const) style.setProperty(property, color(id, legacy!));
  // Source editor chrome is native; Live keeps its tuned content values.
  for (const [name, id, legacy] of [
    ['selection', 'editor.selectionBackground', fallback['--vscode-editor-selectionBackground']],
    ['inactive-selection', 'editor.inactiveSelectionBackground', fallback['--vscode-editor-selectionBackground']],
    ['caret', 'editorCursor.foreground', fallback['--vscode-editor-foreground']],
    ['line', 'editor.lineHighlightBackground', 'transparent'],
    ['line-border', 'editor.lineHighlightBorder', 'transparent'],
    ['line-number', 'editorLineNumber.foreground', fallback['--vscode-editorLineNumber-foreground']],
    ['active-line-number', 'editorLineNumber.activeForeground', fallback['--vscode-editor-foreground']]
  ] as const) style.setProperty('--meo-source-' + name, color(id, legacy!));
}
