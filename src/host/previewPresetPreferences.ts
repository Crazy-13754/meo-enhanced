import {
  decodePreviewPresetPreferences, editablePreviewPresetPreference, getPresetInitialAppearance,
  type PreviewPresetDefinition, type PreviewPresetId, type PreviewPresetPreference,
  type PreviewPresetPreferencePatch, type PreviewPresetPreferences
} from '../foundation/previewPresets';

export const PREVIEW_PRESET_PREFERENCES_STATE_KEY = 'previewPresetPreferences';

/** One owner per extension instance. Reads wait for pending writes; failed writes leave the last saved state intact. */
export function createPreviewPresetPreferences(dependencies: {
  readStored: () => unknown;
  writeStored: (preferences: PreviewPresetPreferences) => PromiseLike<void>;
  getPreset: (id: PreviewPresetId) => PreviewPresetDefinition | undefined;
}) {
  const stored = dependencies.readStored();
  let preferences = stored === undefined ? undefined : decodePreviewPresetPreferences(stored) ?? {};
  let pending: Promise<void> = Promise.resolve();
  return {
    async read(): Promise<PreviewPresetPreferences | undefined> {
      await pending;
      return preferences === undefined ? undefined : structuredClone(preferences);
    },
    update(preset: PreviewPresetId, preference: PreviewPresetPreferencePatch, initialPreference: PreviewPresetPreference, onlyIfMissing = false): Promise<void> {
      const operation = pending.then(async () => {
        if (onlyIfMissing && preferences?.[preset]) return;
        // Default already has a configuration owner. Never introduce a second authority for it.
        const definition = preset === 'default' ? undefined : dependencies.getPreset(preset);
        if (!definition) return;
        const patch = editablePreviewPresetPreference(definition, preference);
        if (!Object.keys(patch).length) return;
        const next = { ...preferences, [preset]: {
          appearance: getPresetInitialAppearance(definition), contentWidth: definition.defaults.contentWidth,
          ...editablePreviewPresetPreference(definition, initialPreference),
          ...preferences?.[preset], ...patch
        } };
        // The initial snapshot only seeds missing fields; stale panels can change one field without overwriting others.
        await dependencies.writeStored(next);
        preferences = next;
      });
      pending = operation.catch(() => {});
      return operation;
    }
  };
}
