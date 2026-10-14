import assert from 'node:assert/strict';
import {
  decodePreviewPresetPreferences, getPresetInitialAppearance, getPreviewPreset, previewPresets,
  type PreviewPresetPreferences, type PreviewPresetPreference
} from '../src/foundation/previewPresets';
import { createCustomPreviewPreset, parseCustomPreviewPresetManifest } from '../src/foundation/customPreviewPreset';
import { createPreviewPresetPreferences } from '../src/host/previewPresetPreferences';
import { decodeEditorCommand } from '../src/protocol/editorCommands';

const initial: PreviewPresetPreference = { appearance: 'auto', contentWidth: 'responsive', fontFamily: 'Georgia', sourceColoring: true, showComments: false };
for (const preset of previewPresets) {
  assert.equal(getPresetInitialAppearance(preset), preset.id === 'newsprint' ? 'light' : 'auto');
  assert.equal('appearance' in preset.defaults, false, 'Manifests do not own an initial appearance');
}
for (const themes of [{ light: { css: 'light.css' }, dark: { css: 'dark.css' } }, { dark: { css: 'dark.css' } }]) {
  const custom = createCustomPreviewPreset(parseCustomPreviewPresetManifest({ schemaVersion: 1, id: 'memory', name: 'Memory', description: 'Memory fixture', base: 'default', themes }), { light: '', dark: '' }, 'a'.repeat(64));
  assert.equal(getPresetInitialAppearance(custom), themes.light ? 'auto' : 'dark');
}
const command = { type: 'setPreviewPresetPreference', preset: 'whitey', preference: { fontFamily: ' Arial ' }, initialPreference: initial };
assert.deepEqual(decodeEditorCommand(command), { ...command, preference: { fontFamily: 'Arial' } });
for (const preference of [null, [], {}, { sourceColoring: undefined }, { fontFamily: 'bad; font' }, { sourceColoring: 'false' }, { showComments: 1 }, { appearance: 'system' }, { contentWidth: 'wide' }, { ignored: true }]) {
  assert.equal(decodeEditorCommand({ ...command, preference }), null);
}
assert.equal(decodeEditorCommand({ ...command, initialPreference: { sourceColoring: true } }), null);
assert.equal(decodeEditorCommand({ ...command, onlyIfMissing: 'true' }), null);
assert.equal(decodePreviewPresetPreferences({ whitey: { ...initial, showComments: 'true' } }), null);
assert.deepEqual(decodePreviewPresetPreferences({ 'user:temporarily-removed': initial }), { 'user:temporarily-removed': initial });

let stored: PreviewPresetPreferences | undefined;
let fail = false;
const dependencies = {
  readStored: () => stored,
  writeStored: async (next: PreviewPresetPreferences) => {
    await Bun.sleep(2);
    if (fail) throw new Error('write failed');
    stored = structuredClone(next);
  },
  getPreset: (id: Parameters<typeof getPreviewPreset>[0]) => id?.startsWith('user:') ? undefined : getPreviewPreset(id)
};
let owner = createPreviewPresetPreferences(dependencies);
assert.equal(await owner.read(), undefined, 'Absent Host memory allows one-time legacy migration');
await Promise.all([
  owner.update('whitey', { appearance: 'dark' }, initial),
  owner.update('obsidian-minimal', { fontFamily: 'Arial' }, initial),
  owner.update('whitey', { sourceColoring: false }, { ...initial, appearance: 'light' })
]);
assert.deepEqual((await owner.read())?.whitey, { ...initial, appearance: 'dark', sourceColoring: false }, 'Concurrent documents merge fields without stale snapshots overwriting new choices');
assert.equal((await owner.read())?.['obsidian-minimal']?.fontFamily, 'Arial', 'Concurrent writes preserve other presets');
await owner.update('whitey', { ...initial, appearance: 'light' }, initial, true);
assert.equal((await owner.read())?.whitey?.appearance, 'dark', 'Late legacy migrations never replace a newer Host entry');
owner = createPreviewPresetPreferences(dependencies);
assert.equal((await owner.read())?.whitey?.appearance, 'dark', 'A new extension instance restores saved preferences');
const copy = (await owner.read())!;
copy.whitey!.appearance = 'light';
assert.equal((await owner.read())?.whitey?.appearance, 'dark', 'Read snapshots cannot mutate the owner');
await owner.update('default', { appearance: 'dark' }, initial);
await owner.update('user:missing', { appearance: 'dark' }, initial);
await owner.update('github-readme', { fontFamily: 'Arial', sourceColoring: false, showComments: true, contentWidth: 'reference' }, initial);
assert.equal((await owner.read())?.default, undefined);
assert.equal((await owner.read())?.['user:missing'], undefined);
assert.equal((await owner.read())?.['github-readme'], undefined, 'Fixed and unsupported controls cannot create stored overrides');
await owner.update('newsprint', { fontFamily: 'Arial', appearance: 'dark' }, initial);
assert.equal((await owner.read())?.newsprint?.appearance, 'light', 'Single-theme presets enforce the supported appearance');
fail = true;
await assert.rejects(owner.update('whitey', { appearance: 'light' }, initial), /write failed/);
assert.equal((await owner.read())?.whitey?.appearance, 'dark', 'A failed save does not claim to have persisted a new choice');
fail = false;
const write = owner.update('whitey', { showComments: true }, initial);
assert.equal((await owner.read())?.whitey?.showComments, true, 'New document reads wait for pending persistence');
await write;
console.log('Preview preset preference defaults, protocol, restart, concurrency and persistence failure tests passed.');
