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
  const infos: ReturnType<typeof createPreviewPresetInfo>[] = [];
  const clear = () => { for (const info of infos.splice(0)) info.dispose(); };
  const t = (language: UiLanguage, zh: string, en: string) => settingsText(language, zh, en);
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
  };
  const button = (text: string, className = 'settings-button') => { const element = node('button', className, text); element.type = 'button'; element.disabled = pending; return element; };
  const perform = async (action: PreviewPresetAction) => {
    if (pending || disposed) return;
    pending = true; error = ''; options.changed();
    try {
      const result = await options.request(action);
      if (!result.ok) error = result.error.message;
    } catch (failure) { error = String(failure); }
    pending = false; if (!disposed) options.changed();
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
        const text = node('span', 'settings-item-text'); text.append(node('span', 'settings-item-title', preset.name[language]), node('span', 'settings-context', builtIn ? t(language, '内置 · 始终启用', 'Built-in · Always enabled') : `${t(language, '自定义', 'Custom')} · ${preset.id.slice(5)}`));
        label.append(input, text); row.append(label);
        const info = createPreviewPresetInfo('settings-preset-info');
        const errors = options.getDiagnostics().filter(diagnostic => diagnostic.preset === preset.id).map(diagnostic => diagnostic.message);
        info.present(preset, language, errors); infos.push(info); row.append(info.element);
        if (!builtIn) {
          const actions = node('details', 'settings-preset-actions'); const summary = node('summary', 'settings-button settings-subtle', t(language, '更多', 'More'));
          summary.setAttribute('aria-label', `${preset.name[language]} · ${t(language, '更多操作', 'More actions')}`);
          const controls = node('div', 'settings-preset-action-list');
          for (const action of ['export', 'remove'] as const) {
            const control = button(action === 'export' ? t(language, '导出', 'Export') : t(language, '移除', 'Remove'), `settings-button settings-subtle${action === 'remove' ? ' settings-warning' : ''}`);
            control.dataset.presetAction = action;
            control.addEventListener('click', () => { actions.open = false; void perform({ action, preset: preset.id, language }); }); controls.append(control);
          }
          actions.append(summary, controls); row.append(actions);
        }
        return row;
      }
      const action = item.action!; row.dataset.presetAction = action;
      const text = node('div', 'settings-item-text');
      text.append(node('div', 'settings-item-title', action === 'import' ? t(language, '导入预设', 'Import preset') : t(language, '制作指南', 'Creation guide')));
      text.append(node('p', 'settings-description', action === 'import'
        ? t(language, '选择预设文件夹。复制保存，原始文件保留；相同 ID 可更新。', 'Select a preset folder. Import keeps the original files; the same ID updates an existing preset.')
        : t(language, '在 GitHub 查看制作步骤、配置说明和示例。', 'View authoring steps, configuration and examples on GitHub.')));
      const control = button(action === 'import' ? t(language, '导入预设…', 'Import preset…') : t(language, '制作指南 ↗', 'Creation guide ↗'));
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
