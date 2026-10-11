import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { createPreviewPresetLibrary } from './customPreviewPresets';
import { createVscodePreviewPresetStorage, PreviewPresetPackageError, readVscodePreviewPresetFolder, writeVscodePreviewPresetPackage } from './vscodePreviewPresetStorage';
import { isPreviewPresetId, type PreviewPresetId } from '../foundation/previewPresets';
import { decodeDisabledPreviewPresets, type PreviewPresetAction } from '../protocol/previewPresets';

export async function createVscodePreviewPresets(context: vscode.ExtensionContext) {
  const directory = vscode.Uri.joinPath(context.globalStorageUri, 'preview-presets');
  const library = createPreviewPresetLibrary(createVscodePreviewPresetStorage(directory));
  // A storage failure must not prevent the editor and built-in presets from opening.
  let errors: string[];
  try {
    await vscode.workspace.fs.createDirectory(directory);
    errors = await library.load();
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)];
    library.reportError(undefined, errors[0]);
  }
  if (errors.length) void vscode.window.showWarningMessage(`${errors.length} custom preview preset(s) could not be loaded: ${errors.join('; ')}`);
  const disabledKey = 'previewPresets.disabled';
  let disabled = decodeDisabledPreviewPresets(context.globalState.get(disabledKey, [])) ?? [];
  const saveDisabled = async (next: PreviewPresetId[]) => {
    const available = next.filter(id => !!library.get(id));
    await context.globalState.update(disabledKey, available);
    disabled = available;
  };
  let queue: Promise<unknown> = Promise.resolve();
  async function perform(request: PreviewPresetAction): Promise<{ changed: boolean }> {
    const zh = request.language === 'zh-CN';
    if (request.action === 'guide') {
      const guide = vscode.Uri.parse(`https://github.com/huangko555/meo-enhanced/blob/main/preview-presets/${zh ? 'README.zh-CN.md' : 'README.md'}`);
      if (!await vscode.env.openExternal(guide)) throw new Error(zh ? '无法打开制作指南，请重试。' : 'Unable to open the creation guide. Please retry.');
      return { changed: false };
    }
    if (request.action === 'import') {
      const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: zh ? '选择预设文件夹' : 'Select preset folder' });
      if (!selected?.[0]) return { changed: false };
      let importId: PreviewPresetId | undefined;
      try {
        const imported = await readVscodePreviewPresetFolder(selected[0]);
        importId = `user:${imported.manifest.id}`;
        const existing = library.get(importId);
        if (existing) {
          const update = zh ? '更新' : 'Update';
          if (await vscode.window.showWarningMessage(zh ? `更新预设“${existing.name['zh-CN']}”？` : `Update preset “${existing.name.en}”?`, { modal: true }, update) !== update) return { changed: false };
        }
        const preset = await library.import(JSON.stringify(imported.manifest), async path => imported.files[path]);
        // Reimporting preserves visibility; a newly installed package starts enabled.
        if (!existing && disabled.includes(preset.id)) await saveDisabled(disabled.filter(id => id !== preset.id));
        void vscode.window.showInformationMessage(zh ? `已导入预设“${preset.name['zh-CN']}”。` : `Preset “${preset.name.en}” imported.`);
        return { changed: true };
      } catch (error) {
        library.reportError(error instanceof PreviewPresetPackageError ? error.preset : importId, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    if (!('preset' in request) || !isPreviewPresetId(request.preset) || !request.preset.startsWith('user:')) throw new Error('Built-in presets are always enabled and cannot be removed.');
    const preset = library.get(request.preset);
    if (!preset) throw new Error('Preview preset is unavailable.');
    if (request.action === 'setEnabled') {
      const next = disabled.filter(id => id !== preset.id);
      if (!request.enabled) next.push(preset.id);
      await saveDisabled(next);
      return { changed: true };
    }
    if (request.action === 'remove') {
      const remove = zh ? '移除' : 'Remove';
      if (await vscode.window.showWarningMessage(zh ? `移除预设“${preset.name['zh-CN']}”？原始文件会保留。` : `Remove preset “${preset.name.en}”? Original files will be kept.`, { modal: true }, remove) !== remove) return { changed: false };
      await library.remove(preset.id);
      if (disabled.includes(preset.id)) await saveDisabled(disabled.filter(id => id !== preset.id));
      void vscode.window.showInformationMessage(zh ? '预设已移除；使用它的预览将切回默认预设。' : 'Preset removed; affected previews will return to Default.');
      return { changed: true };
    }
    const target = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: zh ? '选择预设导出目录' : 'Select preset export folder' });
    if (!target?.[0]) return { changed: false };
    const stored = library.files(preset.id)!;
    const destination = vscode.Uri.joinPath(target[0], `${stored.manifest.id}-${randomUUID().slice(0, 8)}`);
    await writeVscodePreviewPresetPackage(destination, stored);
    void vscode.window.showInformationMessage(zh ? `预设文件已导出：${destination.fsPath}` : `Preset files exported: ${destination.fsPath}`);
    return { changed: false };
  }
  return {
    ...library,
    disabled: () => disabled.filter(id => !!library.get(id)),
    perform(request: PreviewPresetAction) {
      const operation = queue.then(() => perform(request));
      queue = operation.catch(() => undefined);
      return operation;
    }
  };
}
