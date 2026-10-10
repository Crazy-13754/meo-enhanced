import * as vscode from 'vscode';
import { createEditingPreferencesHost, EDITING_PREFERENCES_SETTING } from './editingPreferences';
import { normalizeEditingPreferences } from '../application/editingPreferences';
import type { EditingPreferences } from '../foundation/editingPreferences';
import type { UiLanguage } from '../foundation/uiLanguage';

export async function createVscodeEditingPreferences(uiLanguage: UiLanguage) {
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
