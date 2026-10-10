import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { createPreviewPresetLibrary } from './customPreviewPresets';
import { createVscodePreviewPresetStorage, PreviewPresetPackageError, readVscodePreviewPresetPackage, writeVscodePreviewPresetPackage } from './vscodePreviewPresetStorage';
import type { PreviewPresetId } from '../foundation/previewPresets';
import type { UiLanguage } from '../foundation/uiLanguage';

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
  return {
    ...library,
    async manage(language: UiLanguage): Promise<{ selected?: PreviewPresetId; changed: boolean }> {
      const zh = language === 'zh-CN';
      const action = await vscode.window.showQuickPick([
        { label: zh ? '导入 / 更新预设…' : 'Import / update preset…', action: 'import' },
        { label: zh ? '导出预设文件…' : 'Export preset files…', action: 'export' },
        { label: zh ? '移除预设…' : 'Remove preset…', action: 'remove' },
        { label: zh ? '打开样式存储目录' : 'Open preset storage folder', action: 'folder' },
        { label: zh ? '配置指南' : 'Configuration guide', action: 'guide' }
      ], { title: zh ? '管理自定义预设' : 'Manage custom presets' });
      if (!action) return { changed: false };
      if (action.action === 'guide') {
        const guide = vscode.Uri.joinPath(context.extensionUri, 'docs', zh ? 'custom-preview-presets.md' : 'custom-preview-presets.en.md');
        await vscode.commands.executeCommand('markdown.showPreview', guide);
        return { changed: false };
      }
      if (action.action === 'folder') {
        await vscode.commands.executeCommand('revealFileInOS', directory);
        return { changed: false };
      }
      if (action.action === 'import') {
        const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Preset JSON / JSONC': ['jsonc', 'json'] }, title: zh ? '选择预设配置文件' : 'Select preset configuration' });
        if (!selected?.[0]) return { changed: false };
        let importId: PreviewPresetId | undefined;
        try {
          const imported = await readVscodePreviewPresetPackage(selected[0]);
          importId = `user:${imported.manifest.id}`;
          const preset = await library.import(JSON.stringify(imported.manifest), async path => imported.files[path]);
          void vscode.window.showInformationMessage(zh ? `已保存预设“${preset.name['zh-CN']}”。` : `Preset “${preset.name.en}” saved.`);
          return { changed: true, selected: preset.id };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          library.reportError(error instanceof PreviewPresetPackageError ? error.preset : importId, message);
          throw error;
        }
      }
      const preset = await vscode.window.showQuickPick(library.list().map(preset => ({ label: preset.name[language], description: preset.id.slice(5), preset })), { title: zh ? '选择自定义预设' : 'Select custom preset' });
      if (!preset) return { changed: false };
      if (action.action === 'remove') {
        await library.remove(preset.preset.id);
        void vscode.window.showInformationMessage(zh ? '预设已移除；使用它的预览将切回默认预设。' : 'Preset removed; affected previews will return to Default.');
        return { changed: true };
      }
      const target = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: zh ? '选择预设导出目录' : 'Select preset export folder' });
      if (!target?.[0]) return { changed: false };
      const stored = library.files(preset.preset.id)!;
      const destination = vscode.Uri.joinPath(target[0], `${stored.manifest.id}-${randomUUID().slice(0, 8)}`);
      await writeVscodePreviewPresetPackage(destination, stored);
      void vscode.window.showInformationMessage(zh ? `预设文件已导出：${destination.fsPath}` : `Preset files exported: ${destination.fsPath}`);
      return { changed: false };
    }
  };
}
