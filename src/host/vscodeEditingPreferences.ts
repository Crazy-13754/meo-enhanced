import * as vscode from 'vscode';
import { createEditingPreferencesHost, EDITING_PREFERENCES_SETTING } from './editingPreferences';
import { normalizeEditingPreferences } from '../application/editingPreferences';
import type { EditingPreferences } from '../foundation/editingPreferences';
import type { UiLanguage } from '../foundation/uiLanguage';

const PASTE_HTML_DEFAULT_OFF_MIGRATION_KEY = 'pasteHtmlDefaultOffMigration';

export async function createVscodeEditingPreferences(uiLanguage: UiLanguage, context: {
  readonly globalState: Pick<vscode.Memento, 'get' | 'update'>;
  readonly workspaceState: Pick<vscode.Memento, 'get' | 'update'>;
}) {
  // Each workspace can retain an old override after the profile has migrated.
  // Record completion only after saving, so failures retry and later choices survive.
  for (const [target, state, scope] of [
    [vscode.ConfigurationTarget.Global, context.globalState, 'globalValue'],
    [vscode.ConfigurationTarget.Workspace, context.workspaceState, 'workspaceValue']
  ] as const) {
    if (state.get(PASTE_HTML_DEFAULT_OFF_MIGRATION_KEY) === true) continue;
    const configuration = vscode.workspace.getConfiguration('meoEnhanced');
    const stored = configuration.inspect<EditingPreferences>(EDITING_PREFERENCES_SETTING)?.[scope];
    if (stored?.input?.pasteHtml === true) {
      await configuration.update(EDITING_PREFERENCES_SETTING, {
        ...stored, input: { ...stored.input, pasteHtml: false }
      }, target);
    }
    await state.update(PASTE_HTML_DEFAULT_OFF_MIGRATION_KEY, true);
  }
  const configuration = vscode.workspace.getConfiguration('meoEnhanced');
  const stored = configuration.inspect<EditingPreferences>(EDITING_PREFERENCES_SETTING)?.globalValue;
  // Inspect the saved value, since the schema's false default is not an initialized preference.
  // Save once per profile so later language changes cannot change the initial choice.
  if (typeof stored?.input?.slashPreferAbove !== 'boolean') {
    const preferences = normalizeEditingPreferences(stored);
    await configuration.update(EDITING_PREFERENCES_SETTING, {
      ...preferences, input: { ...preferences.input, slashPreferAbove: uiLanguage === 'zh-CN' }
    }, vscode.ConfigurationTarget.Global);
  }
  return createEditingPreferencesHost({
    platform: process.platform === 'darwin' ? 'mac' : 'other',
    read: () => vscode.workspace.getConfiguration('meoEnhanced').get(EDITING_PREFERENCES_SETTING),
    write: async preferences => {
      const configuration = vscode.workspace.getConfiguration('meoEnhanced');
      const inspected = configuration.inspect(EDITING_PREFERENCES_SETTING);
      const target = inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await configuration.update(EDITING_PREFERENCES_SETTING, preferences, target);
    }
  });
}
