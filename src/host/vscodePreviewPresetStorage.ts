import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { MAX_PRESET_FILE_BYTES } from '../foundation/customPreviewPreset';
import { parsePreviewPresetJsonc, resolveStoredPreviewPreset, type PreviewPresetStorage, type StoredPreviewPreset } from './customPreviewPresets';
import type { PreviewPresetId } from '../foundation/previewPresets';

export class PreviewPresetPackageError extends Error {
  constructor(message: string, readonly preset?: PreviewPresetId) { super(message); }
}

async function statIfPresent(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try { return await vscode.workspace.fs.stat(uri); }
  catch (error) {
    if (['FileNotFound', 'ENOENT'].includes((error as { code?: string }).code ?? '')) return undefined;
    throw error;
  }
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
  if (!await statIfPresent(uri)) await vscode.workspace.fs.createDirectory(uri);
  if ((await vscode.workspace.fs.stat(uri)).type !== vscode.FileType.Directory) throw new Error(`${uri.path}: expected a directory without symbolic links`);
}

async function readText(uri: vscode.Uri, limit = MAX_PRESET_FILE_BYTES): Promise<string> {
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type !== vscode.FileType.File || stat.size > limit) throw new Error(`${uri.path}: file is missing, linked or too large`);
  return new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(uri));
}

/** Uses the same relative-path and file validation for imported and saved packages. */
export async function readVscodePreviewPresetPackage(manifestUri: vscode.Uri): Promise<StoredPreviewPreset> {
  const directory = vscode.Uri.joinPath(manifestUri, '..');
  if ((await vscode.workspace.fs.stat(directory)).type !== vscode.FileType.Directory) throw new Error(`${directory.path}: symbolic links are not supported`);
  let manifest: StoredPreviewPreset['manifest'] | undefined;
  try {
    manifest = parsePreviewPresetJsonc(await readText(manifestUri));
    const files: Record<string, string> = {};
    for (const file of [manifest.styles?.common, manifest.themes.light?.css, manifest.themes.dark?.css]) {
      if (!file || file in files) continue;
      let uri = directory;
      for (const part of file.split('/')) {
        uri = vscode.Uri.joinPath(uri, part);
        if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.SymbolicLink) throw new Error(`${file}: symbolic links are not supported`);
      }
      files[file] = await readText(uri);
    }
    return resolveStoredPreviewPreset({ manifest, files }).stored;
  } catch (error) {
    throw new PreviewPresetPackageError(`${manifestUri.path}: ${error instanceof Error ? error.message : String(error)}`, manifest ? `user:${manifest.id}` : undefined);
  }
}

/** A folder is one preset package. Ambiguous manifests must not silently overwrite a different preset. */
export async function readVscodePreviewPresetFolder(directory: vscode.Uri): Promise<StoredPreviewPreset> {
  const manifests: vscode.Uri[] = [];
  for (const filename of ['preset.jsonc', 'preset.json']) {
    const uri = vscode.Uri.joinPath(directory, filename);
    if (await statIfPresent(uri)) manifests.push(uri);
  }
  if (manifests.length !== 1) throw new Error('Select a preset folder containing exactly one preset.jsonc or preset.json.');
  return readVscodePreviewPresetPackage(manifests[0]);
}

/** Writes into a new package directory; callers decide when the complete package becomes visible. */
export async function writeVscodePreviewPresetPackage(directory: vscode.Uri, preset: StoredPreviewPreset): Promise<void> {
  const { stored } = resolveStoredPreviewPreset(preset);
  await ensureDirectory(directory);
  for (const [file, css] of Object.entries(stored.files)) {
    const uri = vscode.Uri.joinPath(directory, file);
    await ensureDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(css));
  }
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, 'preset.jsonc'), new TextEncoder().encode(JSON.stringify(stored.manifest, null, 2) + '\n'));
}

export function createVscodePreviewPresetStorage(directory: vscode.Uri): PreviewPresetStorage {
  const paths = (id: string) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid saved preset ID');
    return {
      current: vscode.Uri.joinPath(directory, id),
      previous: vscode.Uri.joinPath(directory, `.${id}.previous`),
      legacy: vscode.Uri.joinPath(directory, `${id}.json`)
    };
  };
  const readPackage = async (uri: vscode.Uri, id: string) => {
    const preset = await readVscodePreviewPresetPackage(vscode.Uri.joinPath(uri, 'preset.jsonc'));
    if (preset.manifest.id !== id) throw new Error('Saved preset ID does not match its folder');
    return preset;
  };
  const discard = async (uri: vscode.Uri) => {
    try {
      const stat = await statIfPresent(uri);
      if (stat?.type === vscode.FileType.Directory) await vscode.workspace.fs.delete(uri, { recursive: true });
    } catch { /* Leftover transaction directories are never listed as presets. */ }
  };
  const recover = async (id: string) => {
    const { current, previous } = paths(id);
    if (!await statIfPresent(previous)) return;
    if (!await statIfPresent(current)) {
      await readPackage(previous, id);
      await vscode.workspace.fs.rename(previous, current, { overwrite: false });
      return;
    }
    try { await readPackage(current, id); }
    catch {
      await readPackage(previous, id);
      const invalid = vscode.Uri.joinPath(directory, `.${id}.invalid-${randomUUID()}`);
      await vscode.workspace.fs.rename(current, invalid, { overwrite: false });
      try { await vscode.workspace.fs.rename(previous, current, { overwrite: false }); }
      catch (error) {
        await vscode.workspace.fs.rename(invalid, current, { overwrite: false });
        throw error;
      }
      return;
    }
    await discard(previous);
  };
  const archiveLegacy = async (id: string) => {
    const { legacy } = paths(id);
    if (!await statIfPresent(legacy)) return;
    if ((await vscode.workspace.fs.stat(legacy)).type !== vscode.FileType.File) throw new Error('Legacy preset must be a regular file');
    const backup = vscode.Uri.joinPath(directory, '.legacy');
    await ensureDirectory(backup);
    await vscode.workspace.fs.rename(legacy, vscode.Uri.joinPath(backup, `${id}-${randomUUID()}.json`), { overwrite: false });
  };
  const storage: PreviewPresetStorage = {
    list: async () => {
      await ensureDirectory(directory);
      const ids = new Set<string>();
      for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
        if (type === vscode.FileType.Directory && /^[a-z][a-z0-9-]{0,63}$/.test(name)) ids.add(name);
        if (type === vscode.FileType.File && /^[a-z][a-z0-9-]{0,63}\.json$/.test(name)) ids.add(name.slice(0, -5));
        const previous = /^\.([a-z][a-z0-9-]{0,63})\.previous$/.exec(name);
        if (type === vscode.FileType.Directory && previous) ids.add(previous[1]);
      }
      return [...ids];
    },
    read: async id => {
      const { current, legacy } = paths(id);
      await recover(id);
      if (await statIfPresent(current)) {
        const preset = await readPackage(current, id);
        try { await archiveLegacy(id); } catch { /* The folder remains authoritative if legacy archival fails. */ }
        return preset;
      }
      const { stored } = resolveStoredPreviewPreset(JSON.parse(await readText(legacy, 12 * 1024 * 1024)));
      if (stored.manifest.id !== id) throw new Error('Saved preset ID does not match its filename');
      try {
        await storage.write(id, stored);
        await archiveLegacy(id);
      } catch { /* Migration failures keep the complete legacy preset usable. */ }
      return stored;
    },
    write: async (id, preset) => {
      const { current, previous } = paths(id);
      const expected = resolveStoredPreviewPreset(preset);
      if (expected.stored.manifest.id !== id) throw new Error('Saved preset ID does not match its folder');
      await ensureDirectory(directory);
      await recover(id);
      if (await statIfPresent(previous)) throw new Error('A previous preset version still awaits recovery');
      const pending = vscode.Uri.joinPath(directory, `.${id}.pending-${randomUUID()}`);
      let movedPrevious = false;
      try {
        await writeVscodePreviewPresetPackage(pending, expected.stored);
        const checked = resolveStoredPreviewPreset(await readPackage(pending, id));
        if (checked.definition.custom!.revision !== expected.definition.custom!.revision) throw new Error('Saved preset contents do not match the imported package');
        if (await statIfPresent(current)) {
          await vscode.workspace.fs.rename(current, previous, { overwrite: false });
          movedPrevious = true;
        }
        await vscode.workspace.fs.rename(pending, current, { overwrite: false });
      } catch (error) {
        if (movedPrevious && !await statIfPresent(current)) {
          try { await vscode.workspace.fs.rename(previous, current, { overwrite: false }); }
          catch { /* Startup recovery can restore the retained previous directory. */ }
        }
        throw error;
      } finally { await discard(pending); }
      await discard(previous);
    },
    remove: async id => {
      const { current, previous } = paths(id);
      await recover(id);
      await archiveLegacy(id);
      // Remove recovery candidates too, so a removed preset cannot return on restart.
      for (const uri of [previous, current]) if (await statIfPresent(uri)) {
        const removed = vscode.Uri.joinPath(directory, `.${id}.removed-${randomUUID()}`);
        await vscode.workspace.fs.rename(uri, removed, { overwrite: false });
        await discard(removed);
      }
    }
  };
  return storage;
}
