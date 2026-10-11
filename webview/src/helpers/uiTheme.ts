import { darkCssVariableOverrides } from '../themes/editorDarkTheme';
import { lightCssVariableOverrides } from '../themes/editorLightTheme';
import { defaultUiColors } from '../themes/defaultUiColors';
import type { UiColorOverrides } from '../../../src/foundation/uiColors';

export const contentVariable = (name: string): string => name.replace('--vscode-', '--meo-content-');

/** Freeze existing document colors independently of native UI tokens. */
export function contentColor(value: string): string {
  return value.replace(/--vscode-[\w-]+/g, name => name !== '--vscode-editor-background' && name in darkCssVariableOverrides ? contentVariable(name) : name);
}

type Rgb = readonly [number, number, number];
const black: Rgb = [0, 0, 0];
const white: Rgb = [255, 255, 255];
const rgb = (value: Rgb): string => `rgb(${value.join(' ')})`;
const linear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (value: Rgb): number => 0.2126 * linear(value[0]) + 0.7152 * linear(value[1]) + 0.0722 * linear(value[2]);
const contrast = (first: Rgb, second: Rgb): number => (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);
const neutral = (value: Rgb): Rgb => {
  const light = luminance(value);
  const channel = Math.round(255 * (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055));
  return [channel, channel, channel];
};

// The cache is only a projection of resolved inputs, never theme state. Theme
// events invalidate it by changing the key; mode switches reuse the same roles.
let paletteCache: { key: string; roles: Record<string, string> } | undefined;

export function applyUiTheme(appearance: 'light' | 'dark', matchesHost: boolean, overrides: UiColorOverrides = {}): void {
  const style = document.documentElement.style;
  const fallback = appearance === 'light' ? lightCssVariableOverrides : darkCssVariableOverrides;
  const defaults = defaultUiColors[appearance];
  const color = (id: string, legacy: string): string => matchesHost ? `var(--vscode-${id.replace(/\./g, '-')}, ${legacy})` : legacy;
  const highContrast = matchesHost && (document.body.classList.contains('vscode-high-contrast')
    || document.body.classList.contains('vscode-high-contrast-light'));
  document.documentElement.dataset.meoUiContrast = highContrast ? 'high' : 'normal';
  document.documentElement.dataset.meoUiColorSource = matchesHost ? 'vscode' : 'default';
  const custom = highContrast ? {} : overrides;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  // Let the browser resolve native CSS values and perform gamut mapping. A
  // one-pixel canvas also handles alpha and OKLab without another color library.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const sample = (value: string, underlay: Rgb = appearance === 'light' ? white : black): Rgb => {
    probe.style.color = value;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    const alpha = pixel[3]! / 255;
    const channel = (index: number): number => Math.round(pixel[index]! * alpha + underlay[index]! * (1 - alpha));
    return [channel(0), channel(1), channel(2)];
  };
  const read = (id: string, legacy: string, underlay?: Rgb): Rgb => sample(color(id, legacy), underlay);
  const mixSpace = CSS.supports('color', 'color-mix(in oklab, black, white)') ? 'oklab' : 'srgb';
  const mix = (first: Rgb, second: Rgb, amount: number): Rgb => sample(`color-mix(in ${mixSpace}, ${rgb(first)} ${(1 - amount) * 100}%, ${rgb(second)} ${amount * 100}%)`);
  const minimumContrast = (value: Rgb, surfaces: readonly Rgb[]): number => Math.min(...surfaces.map(surface => contrast(value, surface)));
  const endpoint = (surfaces: readonly Rgb[]): Rgb => minimumContrast(black, surfaces) >= minimumContrast(white, surfaces) ? black : white;
  const fit = (value: Rgb, surfaces: readonly Rgb[], target: number): Rgb => {
    if (minimumContrast(value, surfaces) >= target) return value;
    const end = endpoint(surfaces);
    if (minimumContrast(end, surfaces) < target) return end;
    let lower = 0, upper = 1;
    for (let step = 0; step < 12; step += 1) {
      const middle = (lower + upper) / 2;
      if (minimumContrast(mix(value, end, middle), surfaces) >= target) upper = middle;
      else lower = middle;
    }
    return mix(value, end, upper);
  };

  try {
    const documentSurface = read('editor.background', fallback['--vscode-editor-background']);
    const nativeSurface = custom.surface ? sample(custom.surface) : read('editorWidget.background', defaults.surface, documentSurface);
    // Large UI areas share the toolbar's low-chroma family. Native menu fills
    // can have an unrelated, strong tint and are not another default input.
    const surface = highContrast || custom.surface ? nativeSurface : mix(nativeSurface, neutral(nativeSurface), 0.30);
    const foreground = custom.text ? sample(custom.text) : neutral(read('foreground', defaults.text, surface));
    const accent = custom.accent ? sample(custom.accent) : read('button.background', defaults.accent, surface);
    const success = custom.success ? sample(custom.success) : read('testing.iconPassed', defaults.success, surface);
    const warning = custom.warning ? sample(custom.warning) : read('editorWarning.foreground', defaults.warning, surface);
    const danger = custom.danger ? sample(custom.danger) : read('errorForeground', defaults.danger, surface);
    const contentSurface = sample(`var(--meo-background, ${rgb(documentSurface)})`, documentSurface);
    // Matches start from the final heading ink. Keep it unchanged when readable,
    // otherwise apply only the existing contrast correction for the menu carrier.
    const textEmphasis = custom.textEmphasis ? sample(custom.textEmphasis) : read('textLink.foreground', defaults.textEmphasis, contentSurface);
    const footnoteBackground = `color-mix(in srgb, ${rgb(textEmphasis)} 12%, transparent)`;
    const contentSurfaces = [contentSurface,
      sample(`var(--meo-inline-code-background, ${rgb(contentSurface)})`, contentSurface),
      sample(footnoteBackground, contentSurface)];
    const tint = endpoint([surface]);
    // All ordinary surfaces must admit one shared neutral foreground. Near
    // middle luminance, a fixed hover mix can otherwise cross that boundary.
    const compatibleSurface = (value: Rgb): Rgb => fit(value, [tint], 4.55);
    const raised = highContrast ? surface : compatibleSurface(mix(surface, tint, appearance === 'light' ? 0.015 : 0.04));
    const nativeFocus = highContrast ? read('focusBorder', rgb(accent), surface) : undefined;
    const nativeBorder = highContrast ? read('contrastBorder', color('widget.border', rgb(tint)), raised) : undefined;
    const nativeActiveBorder = highContrast ? read('contrastActiveBorder', color('focusBorder', rgb(accent)), raised) : undefined;
    const nativeSelection = highContrast ? read('list.activeSelectionBackground', rgb(raised), raised) : undefined;
    const nativeSelectionText = highContrast ? read('list.activeSelectionForeground', rgb(foreground), nativeSelection) : undefined;
    const key = JSON.stringify([appearance, highContrast, surface, raised, foreground, accent, success, warning, danger, textEmphasis, contentSurfaces,
      nativeFocus, nativeBorder, nativeActiveBorder, nativeSelection, nativeSelectionText]);

    if (paletteCache?.key !== key) {
      const hover = highContrast ? raised : compatibleSurface(mix(raised, tint, appearance === 'light' ? 0.04 : 0.08));
      const pressed = highContrast ? raised : compatibleSurface(mix(raised, tint, appearance === 'light' ? 0.08 : 0.13));
      const selected = nativeSelection ?? compatibleSurface(mix(raised, tint, appearance === 'light' ? 0.10 : 0.17));
      const field = highContrast ? raised : compatibleSurface(mix(raised, appearance === 'light' ? white : black, appearance === 'light' ? 0.30 : 0.08));
      const track = highContrast ? surface : compatibleSurface(mix(surface, tint, appearance === 'light' ? 0.12 : 0.17));
      const switchOff = mix(raised, tint, appearance === 'light' ? 0.28 : 0.32);
      const surfaces = [surface, raised, field, hover, pressed, track, ...(highContrast ? [] : [selected])];
      const text = fit(foreground, surfaces, 4.55);
      const muted = highContrast ? text : fit(mix(text, neutral(raised), 0.34), surfaces, 4.55);
      const separator = nativeBorder ?? mix(raised, tint, appearance === 'light' ? 0.13 : 0.12);
      const floatBorder = nativeBorder ?? fit(mix(raised, tint, appearance === 'light' ? 0.20 : 0.19), [surface, raised], 1.3);
      const controlBorder = nativeBorder ?? fit(mix(raised, tint, appearance === 'light' ? 0.35 : 0.30), [surface, raised, field], 3.05);
      const accentHover = fit(mix(accent, endpoint([accent]), appearance === 'light' ? 0.08 : 0.06), [endpoint([accent])], 4.55);
      const onAccent = fit(endpoint([accent, accentHover]), [accent, accentHover], 4.55);
      const accentText = fit(accent, surfaces, 4.55);
      const selectedText = fit(custom.text ? text : neutral(nativeSelectionText ?? text), [selected], 4.55);
      const contentEmphasis = fit(textEmphasis, contentSurfaces, 4.55);
      const roles: Record<string, string> = Object.fromEntries(Object.entries({
        surface, 'surface-raised': raised, 'surface-field': field, 'surface-hover': hover,
        'surface-pressed': pressed, 'surface-selected': selected, 'segmented-track': track,
        text, 'text-muted': muted, 'text-disabled': mix(text, neutral(raised), 0.55),
        'text-selected': selectedText, separator, 'border-float': floatBorder, 'border-control': controlBorder,
        focus: nativeFocus ?? fit(accent, [surface, raised, field], 3.05),
        'selection-border': nativeActiveBorder ?? selected,
        accent, 'accent-hover': accentHover, 'on-accent': onAccent, 'accent-text': accentText,
        'text-emphasis': fit(contentEmphasis, [raised, hover], 4.55),
        'text-emphasis-content': contentEmphasis,
        'text-emphasis-selected': fit(contentEmphasis, [selected], 4.55),
        success: fit(success, surfaces, 4.55), warning: fit(warning, surfaces, 4.55), danger: fit(danger, surfaces, 4.55),
        'switch-off': switchOff, 'on-switch-off': fit(mix(text, neutral(raised), 0.20), [switchOff], 3.05)
      }).map(([role, value]) => [role, rgb(value)]));
      roles['text-emphasis-background'] = footnoteBackground;
      roles.shadow = appearance === 'light' ? '0 4px 12px rgb(0 0 0 / 14%)' : '0 4px 14px rgb(0 0 0 / 38%)';
      roles.scrim = appearance === 'light' ? 'rgb(0 0 0 / 28%)' : 'rgb(0 0 0 / 45%)';
      roles.scrollbar = `color-mix(in srgb, ${rgb(text)} 32%, transparent)`;
      roles['scrollbar-hover'] = `color-mix(in srgb, ${rgb(text)} 48%, transparent)`;
      roles['scrollbar-active'] = `color-mix(in srgb, ${rgb(text)} 62%, transparent)`;
      paletteCache = { key, roles };
    }
    for (const [role, value] of Object.entries(paletteCache.roles)) style.setProperty('--meo-ui-' + role, value);
  } finally {
    probe.remove();
  }
  for (const id of ['font-family', 'editor-font-family']) style.setProperty('--meo-ui-' + id, `var(--vscode-${id})`);
  // Notifications keep their existing component contract, backed by the same
  // roles as menus and controls rather than a second native color mapping.
  for (const [property, role] of Object.entries({
    'notice-surface': 'surface-raised', 'notice-foreground': 'text', 'notice-action-surface': 'accent',
    'notice-action-foreground': 'on-accent', 'notice-action-hover-surface': 'accent-hover',
    'notice-info': 'accent-text', 'notice-warning': 'warning', 'notice-error': 'danger',
    'fixed-baseline-active-background': 'surface-selected', 'fixed-baseline-active-foreground': 'text-selected',
    'fixed-baseline-standby-foreground': 'text-muted'
  })) style.setProperty('--meo-' + property, `var(--meo-ui-${role})`);
  // Source chrome and document navigation retain their native content palette.
  style.setProperty('--meo-outline-foreground', color('editor.foreground', fallback['--vscode-editor-foreground']));
  for (const [name, id, legacy] of [
    ['selection', 'editor.selectionBackground', fallback['--vscode-editor-selectionBackground']],
    ['inactive-selection', 'editor.inactiveSelectionBackground', fallback['--vscode-editor-selectionBackground']],
    ['caret', 'editorCursor.foreground', fallback['--vscode-editor-foreground']],
    ['line', 'editor.lineHighlightBackground', 'transparent'],
    ['line-border', 'editor.lineHighlightBorder', 'transparent'],
    ['line-number', 'editorLineNumber.foreground', fallback['--vscode-editorLineNumber-foreground']],
    ['active-line-number', 'editorLineNumber.activeForeground', fallback['--vscode-editor-foreground']]
  ] as const) style.setProperty('--meo-source-' + name, color(id, legacy));
}
