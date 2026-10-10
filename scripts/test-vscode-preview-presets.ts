import assert from 'node:assert/strict';
import path from 'node:path';
import { mock } from 'bun:test';

class TestUri {
  readonly scheme = 'file';
  constructor(readonly fsPath: string) {}
  static file(value: string) { return new TestUri(path.resolve(value)); }
  static joinPath(uri: TestUri, ...segments: string[]) { return TestUri.file(path.join(uri.fsPath, ...segments)); }
  get path() { return this.fsPath.replace(/\\/g, '/'); }
}
const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
const entries = new Map<string, { type: number; bytes: Uint8Array }>();
const missing = (uri: TestUri) => Object.assign(new Error(`Missing file: ${uri.path}`), { code: 'FileNotFound' });
const mkdir = (uri: TestUri) => {
  for (let current = uri.fsPath; !entries.has(current); current = path.dirname(current)) {
    entries.set(current, { type: FileType.Directory, bytes: new Uint8Array() });
    if (path.dirname(current) === current) break;
  }
};
const put = (uri: TestUri, contents = '', type = FileType.File) => {
  mkdir(TestUri.joinPath(uri, '..'));
  entries.set(uri.fsPath, { type, bytes: new TextEncoder().encode(contents) });
};
const text = (uri: TestUri) => new TextDecoder().decode(entries.get(uri.fsPath)!.bytes);
const descendants = (uri: TestUri) => [...entries].filter(([file]) => file === uri.fsPath || file.startsWith(uri.fsPath + path.sep));
const snapshot = (uri: TestUri) => descendants(uri).map(([file, value]) => [path.relative(uri.fsPath, file), value.type, new TextDecoder().decode(value.bytes)]).sort();
const cloneDirectory = (from: TestUri, to: TestUri) => {
  for (const [file, value] of descendants(from)) put(TestUri.joinPath(to, path.relative(from.fsPath, file)), new TextDecoder().decode(value.bytes), value.type);
};
const picks: (string | undefined)[] = [];
const dialogs: (TestUri[] | undefined)[] = [];
const commands: { command: string; uri: TestUri }[] = [];
let failRename: ((from: TestUri, to: TestUri) => boolean) | undefined;
let failWrite = false;
let failDirectory = false;
let failDelete: ((uri: TestUri) => boolean) | undefined;
let writes = 0;
const filesystem = {
  createDirectory: async (uri: TestUri) => {
    if (failDirectory) throw new Error('Storage unavailable');
    mkdir(uri);
  },
  readDirectory: async (uri: TestUri) => {
    if (!entries.has(uri.fsPath)) throw missing(uri);
    return [...entries].filter(([file]) => path.dirname(file) === uri.fsPath && file !== uri.fsPath).map(([file, value]) => [path.basename(file), value.type]);
  },
  stat: async (uri: TestUri) => {
    const entry = entries.get(uri.fsPath);
    if (!entry) throw missing(uri);
    return { type: entry.type, size: entry.bytes.length };
  },
  readFile: async (uri: TestUri) => {
    const entry = entries.get(uri.fsPath);
    if (!entry) throw missing(uri);
    return entry.bytes;
  },
  writeFile: async (uri: TestUri, bytes: Uint8Array) => {
    if (failWrite) throw new Error('Write failed');
    writes++;
    entries.set(uri.fsPath, { type: FileType.File, bytes });
  },
  rename: async (from: TestUri, to: TestUri, options: { overwrite: boolean }) => {
    assert.equal(options.overwrite, false);
    if (failRename?.(from, to)) throw new Error('Rename failed');
    if (!entries.has(from.fsPath)) throw missing(from);
    if (entries.has(to.fsPath)) throw new Error('Destination exists');
    const moved = descendants(from);
    for (const [file] of moved) entries.delete(file);
    for (const [file, value] of moved) entries.set(path.join(to.fsPath, path.relative(from.fsPath, file)), value);
  },
  delete: async (uri: TestUri, options?: { recursive?: boolean }) => {
    if (failDelete?.(uri)) throw new Error('Delete failed');
    for (const [file] of options?.recursive ? descendants(uri) : [[uri.fsPath]]) entries.delete(file);
  }
};
mock.module('vscode', () => ({
  Uri: TestUri, FileType, workspace: { fs: filesystem },
  commands: { executeCommand: async (command: string, uri: TestUri) => { commands.push({ command, uri }); } },
  window: {
    showQuickPick: async (items: any[]) => {
      const selected = picks.shift();
      return items.find(item => item.action === selected || item.preset?.id === selected);
    },
    showOpenDialog: async () => dialogs.shift(),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined
  }
}));
const { createVscodePreviewPresets } = await import('../src/host/vscodePreviewPresets');
const globalStorageUri = TestUri.file('tmp/preset-storage');
const extensionUri = TestUri.file('tmp/preset-extension');
const context = { globalStorageUri, extensionUri } as never;
const root = TestUri.joinPath(globalStorageUri, 'preview-presets');
const source = TestUri.file('tmp/preset-source');
const manifestUri = TestUri.joinPath(source, 'preset.jsonc');
const cssUri = TestUri.joinPath(source, 'styles/light.css');
const savedDirectory = TestUri.joinPath(root, 'native-test');
const savedManifest = TestUri.joinPath(savedDirectory, 'preset.jsonc');
const savedCss = TestUri.joinPath(savedDirectory, 'styles/light.css');
const previous = TestUri.joinPath(root, '.native-test.previous');
const manifest = { schemaVersion: 1, id: 'native-test', name: 'Native test', description: 'Storage checks', controls: { htmlComments: { mode: 'fixed', value: true }, codeColoring: { mode: 'fixed', value: false } }, themes: { light: { css: 'styles/light.css', codeTheme: 'github-light-default' } } };
const css = ':root {\n  --meo-bg: #fafafa;\n}\n';
put(manifestUri, '// Configuration comments are supported\n' + JSON.stringify(manifest));
put(cssUri, css);
let owner = await createVscodePreviewPresets(context);
const importPreset = () => {
  picks.push('import'); dialogs.push([manifestUri]);
  return owner.manage('zh-CN');
};
assert.deepEqual(await importPreset(), { changed: true, selected: 'user:native-test' });
const original = owner.get('user:native-test')!;
assert.deepEqual(original.controls.htmlComments, { mode: 'fixed', value: true });
assert.deepEqual(original.controls.codeColoring, { mode: 'fixed', value: false });
const saved = snapshot(savedDirectory);
assert.equal(text(savedCss), css, 'CSS is a normal file with actual line breaks');
assert.match(text(savedManifest), /^\{\n  "schemaVersion": 1,/);
assert.equal(entries.has(TestUri.joinPath(root, 'native-test.json').fsPath), false);
const noPending = () => assert.ok([...entries.keys()].every(file => !path.basename(file).includes('.pending-')));
noPending();
failDirectory = true;
assert.deepEqual((await createVscodePreviewPresets(context)).list(), [], 'Unavailable storage does not stop initialization');
failDirectory = false;

put(cssUri, ':root { --meo-bg: #eeeeee; }');
failWrite = true;
await assert.rejects(importPreset(), /Write failed/);
assert.ok(owner.diagnostics().some(issue => issue.preset === original.id && issue.message.includes('Write failed')), 'Import failures retain a diagnostic for the affected preset');
failWrite = false;
assert.deepEqual(snapshot(savedDirectory), saved);
noPending();
failRename = () => true;
await assert.rejects(importPreset(), /Rename failed/);
failRename = undefined;
assert.deepEqual(snapshot(savedDirectory), saved, 'Failing before replacement keeps every previous file');
noPending();
failRename = from => path.basename(from.fsPath).includes('.pending-');
await assert.rejects(importPreset(), /Rename failed/);
failRename = undefined;
assert.deepEqual(snapshot(savedDirectory), saved, 'Failing after moving the old folder restores it completely');
assert.equal(entries.has(previous.fsPath), false);
assert.equal(owner.get(original.id), original);
noPending();
failRename = from => path.basename(from.fsPath).includes('.pending-') || from.fsPath === previous.fsPath;
await assert.rejects(importPreset(), /Rename failed/);
assert.equal(entries.has(savedDirectory.fsPath), false);
assert.deepEqual(snapshot(previous), saved, 'Rollback failure retains a complete recovery copy');
failRename = undefined;
owner = await createVscodePreviewPresets(context);
assert.equal(owner.get(original.id)?.custom?.revision, original.custom!.revision, 'Restart recovers an interrupted folder switch');
assert.deepEqual(snapshot(savedDirectory), saved);

put(TestUri.joinPath(source, 'styles'), '', FileType.Directory | FileType.SymbolicLink);
await assert.rejects(importPreset(), /symbolic links/);
put(TestUri.joinPath(source, 'styles'), '', FileType.Directory);
put(cssUri, '', FileType.File | FileType.SymbolicLink);
await assert.rejects(importPreset(), /symbolic links/);
entries.delete(cssUri.fsPath);
await assert.rejects(importPreset(), /Missing file/);
owner = await createVscodePreviewPresets(context);
assert.equal(owner.get(original.id)?.custom?.revision, original.custom!.revision, 'Restart does not depend on source files');
put(savedManifest, '// Saved JSONC supports comments too\n' + JSON.stringify(JSON.parse(text(savedManifest))));
owner = await createVscodePreviewPresets(context);
assert.equal(owner.get(original.id)?.custom?.revision, original.custom!.revision, 'Saved configuration accepts comments and either JSON formatting');
put(savedCss, ':root { --meo-bg: #bbbbbb; }');
owner = await createVscodePreviewPresets(context);
assert.notEqual(owner.get(original.id)?.custom?.revision, original.custom!.revision, 'Reload reads edits to saved CSS');
put(savedCss, css);
owner = await createVscodePreviewPresets(context);

const legacyRecord = (id: string) => ({ manifest: { ...manifest, id }, files: { 'styles/light.css': css } });
const legacyUri = TestUri.joinPath(root, 'legacy-test.json');
put(legacyUri, JSON.stringify(legacyRecord('legacy-test')));
const failedLegacy = TestUri.joinPath(root, 'legacy-failure.json');
put(failedLegacy, JSON.stringify(legacyRecord('legacy-failure'), null, 2));
failRename = from => path.basename(from.fsPath).startsWith('.legacy-failure.pending-');
owner = await createVscodePreviewPresets(context);
assert.ok(owner.get('user:legacy-test') && owner.get('user:legacy-failure'));
assert.equal(entries.has(legacyUri.fsPath), false);
assert.equal(text(TestUri.joinPath(root, 'legacy-test/styles/light.css')), css);
const legacyBackup = [...entries.keys()].find(file => path.dirname(file) === TestUri.joinPath(root, '.legacy').fsPath && path.basename(file).startsWith('legacy-test-'))!;
assert.deepEqual(JSON.parse(text(TestUri.file(legacyBackup))), legacyRecord('legacy-test'));
assert.equal(entries.has(failedLegacy.fsPath), true, 'Failed migration keeps its legacy file usable');
assert.equal(entries.has(TestUri.joinPath(root, 'legacy-failure').fsPath), false);
failRename = undefined;
owner = await createVscodePreviewPresets(context);
assert.equal(entries.has(failedLegacy.fsPath), false);
assert.equal(owner.list().length, 3, 'Legacy backups and transaction directories are not catalog entries');
const broken = TestUri.joinPath(root, 'broken.json');
put(broken, '{}');
owner = await createVscodePreviewPresets(context);
assert.equal(text(broken), '{}', 'Invalid legacy records are preserved');
assert.equal(entries.has(TestUri.joinPath(root, 'broken').fsPath), false);

cloneDirectory(savedDirectory, previous);
put(savedCss, 'body { background: red; }');
owner = await createVscodePreviewPresets(context);
assert.equal(owner.get(original.id)?.custom?.revision, original.custom!.revision, 'Recovery replaces an incomplete current package with the complete previous package');
assert.ok([...entries.keys()].some(file => path.basename(file).startsWith('.native-test.invalid-')), 'Invalid contents are retained separately');
const beforeCancel = writes;
picks.push(undefined);
assert.deepEqual(await owner.manage('en'), { changed: false });
picks.push('import'); dialogs.push(undefined);
assert.deepEqual(await owner.manage('en'), { changed: false });
picks.push('export', original.id); dialogs.push(undefined);
assert.deepEqual(await owner.manage('en'), { changed: false });
for (const [language, filename] of [['zh-CN', 'custom-preview-presets.md'], ['en', 'custom-preview-presets.en.md']] as const) {
  picks.push('guide');
  assert.deepEqual(await owner.manage(language), { changed: false });
  assert.equal(commands.at(-1)!.command, 'markdown.showPreview');
  assert.equal(commands.at(-1)!.uri.fsPath, path.join(extensionUri.fsPath, 'docs', filename));
}
assert.equal(writes, beforeCancel, 'Canceled dialogs and localized guides do not write presets');

const exportRoot = TestUri.file('tmp/preset-share');
picks.push('export', original.id); dialogs.push([exportRoot]);
assert.deepEqual(await owner.manage('zh-CN'), { changed: false });
const exportedManifest = [...entries.keys()].find(file => file.startsWith(exportRoot.fsPath + path.sep) && path.basename(file) === 'preset.jsonc')!;
assert.equal(text(TestUri.file(path.join(path.dirname(exportedManifest), 'styles/light.css'))), css);
assert.equal(JSON.parse(text(TestUri.file(exportedManifest))).themes.light.css, 'styles/light.css');
dialogs.push([TestUri.file(exportedManifest)]); picks.push('import');
assert.deepEqual(await owner.manage('en'), { changed: true, selected: original.id }, 'Exported folders can be imported directly');

const unrelated = TestUri.joinPath(root, 'notes.txt');
put(unrelated, 'Keep this file');
put(TestUri.joinPath(savedDirectory, 'unreferenced.css'), 'unused');
dialogs.push([TestUri.file(exportedManifest)]); picks.push('import');
await owner.manage('en');
assert.equal(entries.has(TestUri.joinPath(savedDirectory, 'unreferenced.css').fsPath), false, 'Updating replaces the whole package');
cloneDirectory(savedDirectory, previous);
failDelete = uri => uri.fsPath === previous.fsPath;
put(TestUri.joinPath(root, 'native-test.json'), JSON.stringify(legacyRecord('native-test')));
picks.push('remove', original.id);
assert.deepEqual(await owner.manage('zh-CN'), { changed: true });
failDelete = undefined;
assert.equal(owner.get(original.id), undefined);
assert.equal(entries.has(savedDirectory.fsPath) || entries.has(previous.fsPath), false);
assert.equal(text(unrelated), 'Keep this file');
assert.ok(entries.has(manifestUri.fsPath) && entries.has(exportedManifest), 'Removal preserves source and exported packages');
owner = await createVscodePreviewPresets(context);
assert.equal(owner.get(original.id), undefined, 'Removed presets do not return from legacy or recovery copies');
console.log('Preset folders, CSS line breaks, complete replacement, rollback, restart recovery, legacy migration, sharing, removal and localized guides passed.');
