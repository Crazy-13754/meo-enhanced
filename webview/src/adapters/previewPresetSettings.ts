import { BookOpen, createElement, Download, FolderInput, Trash2 } from 'lucide';
import { isPreviewPresetEnabled, previewPresets, type PreviewPresetDefinition, type PreviewPresetDiagnostic } from '../../../src/foundation/previewPresets';
import type { PreviewPresetAction, PreviewPresetResponse } from '../../../src/protocol/previewPresets';
import type { UiLanguage } from '../../../src/foundation/uiLanguage';
import { previewPresetSearchKeywords, settingsSearchMatches, settingsText } from '../application/settingsCatalog';
import { createPreviewPresetInfo } from './previewPresetInfo';

export type PresetSettingItem = { readonly section: 'presetList' | 'presetFiles'; readonly preset?: PreviewPresetDefinition; readonly action?: 'import' | 'guide' };

/** Management changes availability only. Selection remains in the Preview toolbar. */
export function createPreviewPresetSettings(options: {
  request(action: PreviewPresetAction): Promise<PreviewPresetResponse['result']>;
  getDiagnostics(): readonly PreviewPresetDiagnostic[];
  changed(): void;
}) {
  let pending = false;
  let error = '';
  let disposed = false;
  let removal: { anchor: HTMLButtonElement; close(restoreFocus?: boolean): void } | undefined;
  const infos: ReturnType<typeof createPreviewPresetInfo>[] = [];
  const clear = () => { removal?.close(); for (const info of infos.splice(0)) info.dispose(); };
  const t = (language: UiLanguage, zh: string, en: string) => settingsText(language, zh, en);
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
  };
  const button = (text: string, className = 'settings-button') => { const element = node('button', className, text); element.type = 'button'; element.disabled = pending; return element; };
  const actionButton = (label: string, icon: typeof Download, warning = false) => {
    const element = button(label, `settings-button settings-subtle settings-preset-button${warning ? ' settings-warning' : ''}`);
    element.setAttribute('aria-label', label);
    element.prepend(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' })); return element;
  };
  const perform = async (action: PreviewPresetAction) => {
    if (pending || disposed) return;
    pending = true; error = ''; options.changed();
    try {
      const result = await options.request(action);
      if (!result.ok) error = result.error.message;
    } catch (failure) { error = String(failure); }
    pending = false; if (!disposed) options.changed();
  };
  const confirmRemoval = (anchor: HTMLButtonElement, preset: PreviewPresetDefinition, language: UiLanguage) => {
    if (pending || disposed) return;
    if (removal?.anchor === anchor) { removal.close(true); return; }
    removal?.close();
    const owner = anchor.closest('dialog') ?? document.body;
    const popover = node('div', 'settings-preset-remove-popover');
    popover.id = 'settings-preset-remove-confirmation';
    popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-labelledby', `${popover.id}-title`);
    const title = node('p', 'settings-preset-remove-title', t(language, `移除预设“${preset.name[language]}”？`, `Remove preset “${preset.name[language]}”?`));
    title.id = `${popover.id}-title`;
    const actions = node('div', 'settings-actions');
    const cancel = button(t(language, '取消', 'Cancel')); cancel.dataset.presetConfirm = 'cancel';
    const confirm = button(t(language, '移除', 'Remove'), 'settings-button settings-warning'); confirm.dataset.presetConfirm = 'remove';
    actions.append(cancel, confirm); popover.append(title, actions);
    // Keep the confirmation outside the scrolling list so it does not change row layout.
    owner.append(popover);
    const bounds = owner === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : owner.getBoundingClientRect();
    popover.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 16)}px`;
    const target = anchor.getBoundingClientRect(); const size = popover.getBoundingClientRect();
    const below = target.bottom + 6;
    popover.style.left = `${Math.max(bounds.left + 8, Math.min(target.right - size.width, bounds.right - size.width - 8))}px`;
    popover.style.top = `${Math.max(bounds.top + 8, Math.min(below + size.height <= bounds.bottom - 8 ? below : target.top - size.height - 6, bounds.bottom - size.height - 8))}px`;
    const events = new AbortController();
    const close = (restoreFocus = false) => {
      events.abort(); popover.remove(); removal = undefined; anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-controls');
      if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    removal = { anchor, close };
    anchor.setAttribute('aria-expanded', 'true'); anchor.setAttribute('aria-controls', popover.id);
    cancel.addEventListener('click', () => close(true), { signal: events.signal });
    confirm.addEventListener('click', () => { close(); void perform({ action: 'remove', preset: preset.id, language }); }, { signal: events.signal });
    const dismissOutside = (event: Event) => { if (event.target instanceof Node && !popover.contains(event.target) && !anchor.contains(event.target)) close(); };
    document.addEventListener('pointerdown', dismissOutside, { capture: true, signal: events.signal });
    document.addEventListener('focusin', dismissOutside, { signal: events.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }, { capture: true, signal: events.signal });
    window.addEventListener('scroll', () => close(), { capture: true, signal: events.signal });
    window.addEventListener('resize', () => close(), { signal: events.signal });
    window.addEventListener('blur', () => close(), { signal: events.signal });
    owner.addEventListener('close', () => close(), { signal: events.signal });
    cancel.focus({ preventScroll: true });
  };
  return {
    items(query: string): PresetSettingItem[] {
      const presets = previewPresets.filter(preset => settingsSearchMatches(query, ...previewPresetSearchKeywords.list, preset.id, ...Object.values(preset.name), ...Object.values(preset.description), ...preset.notes.flatMap(note => Object.values(note))));
      return [
        ...presets.map(preset => ({ section: 'presetList' as const, preset })),
        ...(['import', 'guide'] as const).filter(action => settingsSearchMatches(query, ...previewPresetSearchKeywords[action])).map(action => ({ section: 'presetFiles' as const, action }))
      ];
    },
    signature: () => JSON.stringify([previewPresets.map(preset => [preset.id, preset.name, preset.custom?.revision, isPreviewPresetEnabled(preset.id)]), options.getDiagnostics(), pending, error]),
    render(item: PresetSettingItem, language: UiLanguage) {
      const row = node('div', 'settings-item settings-preset-row');
      if (item.preset) {
        const preset = item.preset; const builtIn = !preset.id.startsWith('user:'); row.dataset.preset = preset.id;
        const label = node('label', 'settings-preset-label'); const input = node('input', 'settings-preset-checkbox'); input.type = 'checkbox';
        input.checked = isPreviewPresetEnabled(preset.id); input.disabled = pending || builtIn;
        input.setAttribute('aria-label', `${t(language, '显示预设：', 'Show preset: ')}${preset.name[language]}`);
        input.addEventListener('change', () => { void perform({ action: 'setEnabled', preset: preset.id, enabled: input.checked, language }); });
        const text = node('span', 'settings-item-text'); text.append(node('span', 'settings-item-title', preset.name[language]), node('span', 'settings-context', builtIn ? t(language, '内置', 'Built-in') : preset.id.slice(5)));
        label.append(input, text); row.append(label);
        const info = createPreviewPresetInfo('settings-preset-info');
        const errors = options.getDiagnostics().filter(diagnostic => diagnostic.preset === preset.id).map(diagnostic => diagnostic.message);
        info.present(preset, language, errors); infos.push(info); row.append(info.element);
        if (!builtIn) {
          for (const action of ['export', 'remove'] as const) {
            const caption = action === 'export' ? t(language, '导出', 'Export') : t(language, '移除', 'Remove');
            const control = button('', `settings-button settings-subtle settings-preset-button settings-preset-icon${action === 'remove' ? ' settings-warning' : ''}`);
            control.setAttribute('aria-label', `${preset.name[language]} · ${caption}`); control.dataset.tooltip = caption;
            control.append(createElement(action === 'export' ? Download : Trash2, { width: 15, height: 15, 'aria-hidden': 'true' }));
            control.dataset.presetAction = action;
            if (action === 'remove') { control.setAttribute('aria-haspopup', 'dialog'); control.setAttribute('aria-expanded', 'false'); }
            control.addEventListener('click', () => { if (action === 'remove') confirmRemoval(control, preset, language); else void perform({ action, preset: preset.id, language }); }); row.append(control);
          }
        }
        return row;
      }
      const action = item.action!; row.dataset.presetAction = action;
      const text = node('div', 'settings-item-text');
      text.append(node('div', 'settings-item-title', action === 'import' ? t(language, '导入预设', 'Import preset') : t(language, '制作指南', 'Creation guide')));
      text.append(node('p', 'settings-description', action === 'import'
        ? t(language, '选择预设文件夹；相同 ID 可更新。', 'Select a preset folder. Reuse an ID to update its preset.')
        : t(language, '在 GitHub 查看制作步骤、配置说明和示例。', 'View authoring steps, configuration and examples on GitHub.')));
      const control = actionButton(action === 'import' ? t(language, '导入预设', 'Import preset') : t(language, '制作指南', 'Creation guide'), action === 'import' ? FolderInput : BookOpen);
      control.classList.remove('settings-subtle');
      control.addEventListener('click', () => { void perform({ action, language }); }); row.append(text, control);
      return row;
    },
    description(language: UiLanguage) {
      const enabled = previewPresets.filter(preset => isPreviewPresetEnabled(preset.id)).length;
      return t(language, `已安装 ${previewPresets.length} 套，显示 ${enabled} 套。勾选后显示在预览下拉菜单中；隐藏或移除正在使用的预设时回到默认。`, `${previewPresets.length} installed, ${enabled} shown. Checked presets appear in the Preview menu. Hiding or removing a preset in use returns its previews to Default.`);
    },
    clear,
    error: () => error,
    dispose() { disposed = true; clear(); }
  };
}
