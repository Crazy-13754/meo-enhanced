import { createElement, Moon, RotateCcw, Sun } from 'lucide';
import { normalizeUiColor, uiColorKeys, type UiColorKey, type UiColors } from '../../../src/foundation/uiColors';
import type { EditorAppearance } from '../../../src/protocol/editorCommands';
import type { UiColorsResult } from '../../../src/protocol/uiColors';
import type { UiLanguage } from '../../../src/foundation/uiLanguage';
import { appearanceCatalog, sectionTitles, settingsSearchMatches, settingsText } from '../application/settingsCatalog';
import { createSegmentedControl } from './segmentedControl';

export type AppearanceSettingsOptions = {
  getColors(): UiColors;
  getMode(): EditorAppearance;
  getScheme(): 'light' | 'dark';
  setMode(mode: EditorAppearance): void;
  preview(colors: UiColors | null): void;
  update(colors: UiColors): Promise<UiColorsResult['result']>;
  registerInput?: (input: HTMLInputElement) => () => void;
};
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
};
const button = (text: string, className = 'settings-button') => { const element = node('button', className, text); element.type = 'button'; return element; };
const copy = (colors: UiColors): UiColors => ({ light: { ...colors.light }, dark: { ...colors.dark } });

/** The window owns a disposable preview draft; persistence stays with the Host. */
export function createAppearanceSettings(options: AppearanceSettingsOptions) {
  let language: UiLanguage = 'zh-CN';
  let draft: UiColors | null = null;
  let baseline = copy(options.getColors());
  let session = 0;
  let saving = false;
  let closed = false;
  let invalid = new Set<UiColorKey>();
  let presenters: (() => void)[] = [];
  let inputRegistrations: (() => void)[] = [];
  let scheme = options.getScheme();
  let previewFrame: number | undefined;
  const t = (zh: string, en: string) => settingsText(language, zh, en);
  const footer = node('div', 'appearance-footer');
  const reset = button(''); const cancel = button(''); const apply = button('', 'settings-button settings-primary');
  const actions = node('div', 'settings-actions'); actions.append(cancel, apply); footer.append(reset, actions);
  const status = node('p', 'appearance-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const same = (first: UiColors, second: UiColors) => (['light', 'dark'] as const).every(mode => uiColorKeys.every(key => first[mode][key] === second[mode][key]));
  const changed = () => draft !== null && !same(draft, baseline);
  const cancelPreview = () => {
    if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
    previewFrame = undefined;
  };
  const presentActions = () => {
    reset.textContent = t('恢复默认颜色', 'Reset colors'); cancel.textContent = t('取消', 'Cancel'); apply.textContent = saving ? t('保存中…', 'Saving…') : t('应用', 'Apply');
    reset.disabled = saving; cancel.disabled = saving || !changed() && !invalid.size; apply.disabled = saving || !changed() || invalid.size > 0;
  };
  const present = () => {
    const saved = options.getColors();
    if (!same(saved, baseline)) {
      // External configuration changes update untouched inputs without erasing local edits.
      const next = copy(saved);
      if (draft) for (const mode of ['light', 'dark'] as const) for (const key of uiColorKeys) {
        if (draft[mode][key] !== baseline[mode][key]) {
          if (draft[mode][key] === undefined) delete next[mode][key]; else next[mode][key] = draft[mode][key];
        }
      }
      baseline = copy(saved); if (draft) { cancelPreview(); draft = next; options.preview(changed() ? draft : null); }
    }
    const nextScheme = options.getScheme();
    if (nextScheme !== scheme) { scheme = nextScheme; invalid.clear(); }
    for (const show of presenters) show();
    presentActions();
  };
  const flushPreview = () => {
    if (previewFrame === undefined) return;
    cancelPreview();
    options.preview(draft); present();
  };
  const discard = () => { cancelPreview(); baseline = copy(options.getColors()); draft = copy(baseline); invalid.clear(); status.hidden = true; options.preview(null); present(); };
  const change = (key: UiColorKey, value: string | undefined) => {
    draft ??= copy(options.getColors());
    const previous = draft[scheme][key];
    if (value === undefined) delete draft[scheme][key]; else draft[scheme][key] = value;
    invalid.delete(key); status.hidden = true; presentActions();
    if (previous === value) { present(); return; }
    // Native dragging can emit several values per frame. Keep the draft current,
    // but leave expensive palette derivation outside the input callback.
    if (previewFrame === undefined) previewFrame = requestAnimationFrame(flushPreview);
  };
  reset.addEventListener('click', () => { cancelPreview(); draft = { light: {}, dark: {} }; invalid.clear(); status.hidden = true; options.preview(draft); present(); });
  cancel.addEventListener('click', discard);
  apply.addEventListener('click', async () => {
    if (!draft || apply.disabled) return;
    flushPreview();
    const savingSession = session;
    saving = true; status.hidden = true; present();
    let result: UiColorsResult['result'];
    try { result = await options.update(copy(draft)); }
    catch (error) { result = { ok: false, error: { code: 'operation-failed', message: String(error) } }; }
    saving = false;
    if (closed || savingSession !== session) { present(); return; }
    if (result.ok) { baseline = copy(options.getColors()); draft = copy(baseline); options.preview(null); }
    else { status.textContent = (result.error.code === 'timeout' ? t('保存未确认：', 'Save not confirmed: ') : t('保存失败：', 'Unable to save: ')) + result.error.message; status.hidden = false; }
    present();
  });

  const sectionFor = (item: typeof appearanceCatalog[number]) => item.id === 'mode' ? 'appearanceMode' : item.advanced ? 'appearanceAdvanced' : 'appearanceColors';
  const items = (query: string) => appearanceCatalog.filter(item => settingsSearchMatches(query, '外观 Appearance', ...sectionTitles[sectionFor(item)], ...item.title, ...item.description, ...item.keywords, '跟随 VS Code 主题 Follow VS Code theme', item.id));
  function render(nextLanguage: UiLanguage, query: string) {
    for (const unregister of inputRegistrations) unregister(); inputRegistrations = [];
    language = nextLanguage; scheme = options.getScheme(); presenters = []; invalid.clear();
    const visible = items(query); const container = node('div', 'appearance-settings');
    const sections = new Map<string, HTMLElement>();
    for (const id of ['appearanceMode', 'appearanceColors', 'appearanceAdvanced'] as const) {
      if (!visible.some(item => sectionFor(item) === id)) continue;
      const section = node('section', 'settings-section appearance-section'); section.id = 'meo-settings-' + id;
      const titles = sectionTitles[id];
      const heading = node('div', 'appearance-section-heading'); heading.append(node('h3', 'settings-section-title', t(titles[0], titles[1])));
      section.append(heading); sections.set(id, section); container.append(section);
    }
    const note = node('p', 'settings-description appearance-note');
    const schemeLabel = node('span', 'appearance-scheme');
    presenters.push(() => {
      const high = document.documentElement.dataset.meoUiContrast === 'high';
      schemeLabel.textContent = t(scheme === 'light' ? '浅色配色' : '深色配色', `${scheme === 'light' ? 'Light' : 'Dark'} colors`);
      note.textContent = high ? t('高对比度模式使用 VS Code 配色。自定义颜色会保留，切回普通主题后生效。', 'High contrast uses VS Code colors. Custom colors are retained for other themes.')
        : t('留空跟随 VS Code 主题。颜色实时预览，应用后保存。', 'Leave empty to follow the VS Code theme. Preview live; Apply to save.');
    });
    const common = sections.get('appearanceColors');
    common?.querySelector('.appearance-section-heading')?.append(schemeLabel); common?.append(note, status);
    if (!common) container.prepend(status);
    for (const item of visible) {
      const row = node('div', 'settings-item appearance-item'); row.dataset.setting = item.id;
      const text = node('div', 'settings-item-text'); text.append(node('div', 'settings-item-title', t(item.title[0], item.title[1])), node('p', 'settings-description', t(item.description[0], item.description[1]))); row.append(text);
      if (item.id === 'mode') {
        row.classList.add('appearance-mode');
        const modeControl = createSegmentedControl<EditorAppearance>({ ariaLabel: t(...item.title), className: 'editor-appearance-control appearance-mode-control', buttonClassName: 'editor-appearance-button', datasetKey: 'appearanceMode', role: 'group', width: '240px', buttonTitles: false, options: [
          { value: 'auto', label: t('自动', 'Auto') },
          { value: 'light', label: t('浅色', 'Light'), renderLeading: () => createElement(Sun, { width: 12, height: 12, 'aria-hidden': 'true' }) },
          { value: 'dark', label: t('深色', 'Dark'), renderLeading: () => createElement(Moon, { width: 12, height: 12, 'aria-hidden': 'true' }) }
        ] });
        presenters.push(() => modeControl.setActive(options.getMode()));
        for (const value of ['auto', 'light', 'dark'] as const) modeControl.getButton(value).addEventListener('click', () => { flushPreview(); options.setMode(value); present(); });
        row.append(modeControl.element);
      } else {
        const key = item.id; const controls = node('div', 'appearance-color-controls');
        const field = node('div', 'appearance-color-field');
        const chip = node('label', 'appearance-color-chip');
        const swatchInput = node('input', 'appearance-color-swatch'); swatchInput.type = 'color'; swatchInput.setAttribute('aria-label', t(item.title[0], item.title[1]));
        const input = node('input', 'appearance-color-hex'); input.type = 'text'; input.setAttribute('spellcheck', 'false'); input.maxLength = 7; input.placeholder = t('跟随 VS Code 主题', 'Follow VS Code theme'); input.setAttribute('aria-label', t(item.title[0], item.title[1]) + ' HEX'); input.title = t('输入 #RGB 或 #RRGGBB；留空跟随 VS Code 主题。', 'Enter #RGB or #RRGGBB; leave empty to follow the VS Code theme.');
        const unregister = options.registerInput?.(input); if (unregister) inputRegistrations.push(unregister);
        const restore = button('', 'settings-button settings-subtle appearance-color-reset'); restore.setAttribute('aria-label', t(item.title[0], item.title[1]) + ' · ' + t('跟随 VS Code 主题', 'Follow VS Code theme'));
        restore.append(createElement(RotateCcw, { width: 14, height: 14, 'aria-hidden': 'true' }));
        chip.append(swatchInput); field.append(chip, input); controls.append(field, restore); row.append(controls);
        let shownScheme = scheme;
        presenters.push(() => {
          const color = (draft ?? options.getColors())[scheme][key];
          if ((!invalid.has(key) && document.activeElement !== input) || shownScheme !== scheme) { input.value = color ?? ''; input.removeAttribute('aria-invalid'); shownScheme = scheme; }
          restore.disabled = saving || !color && !invalid.has(key); swatchInput.disabled = saving; input.disabled = saving;
          const role = key === 'textEmphasis' ? 'text-emphasis-content' : key;
          const value = color ?? getComputedStyle(document.documentElement).getPropertyValue('--meo-ui-' + role).trim();
          chip.style.backgroundColor = value;
          const rgb = value.match(/^rgb\((\d+)[, ]+(\d+)[, ]+(\d+)/);
          const next = color ?? (rgb ? '#' + rgb.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('') : undefined);
          if (next && swatchInput.value.toUpperCase() !== next.toUpperCase()) swatchInput.value = next;
        });
        swatchInput.addEventListener('input', () => { input.value = swatchInput.value.toUpperCase(); chip.style.backgroundColor = swatchInput.value; input.removeAttribute('aria-invalid'); change(key, input.value); });
        input.addEventListener('input', () => {
          const color = normalizeUiColor(input.value);
          if (!input.value.trim()) { input.removeAttribute('aria-invalid'); change(key, undefined); }
          else if (color) { input.removeAttribute('aria-invalid'); change(key, color); }
          else { invalid.add(key); input.setAttribute('aria-invalid', 'true'); present(); }
        });
        input.addEventListener('blur', () => { if (!invalid.has(key)) { input.value = (draft ?? options.getColors())[scheme][key] ?? ''; } });
        restore.addEventListener('click', () => { input.value = ''; change(key, undefined); });
      }
      sections.get(sectionFor(item))!.append(row);
    }
    if (!visible.length) container.append(node('p', 'settings-empty', t('没有匹配的设置', 'No matching settings')));
    present(); return container;
  }
  return { footer, render, present, count: (query: string) => items(query).length,
    open() { cancelPreview(); session++; closed = false; baseline = copy(options.getColors()); draft = copy(baseline); invalid.clear(); status.hidden = true; },
    close() { cancelPreview(); session++; closed = true; draft = null; invalid.clear(); options.preview(null); },
    dispose() { cancelPreview(); session++; closed = true; draft = null; options.preview(null); for (const unregister of inputRegistrations) unregister(); inputRegistrations = []; presenters = []; },
  };
}
