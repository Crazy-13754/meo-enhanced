import * as vscode from 'vscode';
import { collectWikiReferences, isWikiImageTarget, type ResolvedWikiResources } from '../foundation/wikiReference';
import { resolveUiLanguage } from '../foundation/uiLanguage';

export type WikiResourceResolution = {
  uri?: vscode.Uri;
  candidates?: string[];
  issue?: string;
};

type WikiRoot = { uri: vscode.Uri; obsidian: boolean };
type WikiFileIndex = { files: vscode.Uri[]; byName: Map<string, vscode.Uri[]> };
type FileIndex = {
  files?: Promise<WikiFileIndex>;
  watcher?: vscode.FileSystemWatcher;
  cancellation?: vscode.CancellationTokenSource;
};
const roots = new Map<string, Promise<WikiRoot>>();
const indexes = new Map<string, FileIndex>();
const listeners = new Set<() => void>();
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let lifetime = 0;
const markdownExtensions = ['.md', '.markdown', '.mdx', '.mdc'];
const MAX_INDEX_FILES = 50_000;
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', '.cache', '.obsidian']);

function issue(uri: vscode.Uri, english: string, chinese: string): string {
  return resolveUiLanguage(vscode.workspace.getConfiguration('meoEnhanced', uri).get('language', 'auto'), vscode.env?.language) === 'zh-CN' ? chinese : english;
}

function incompleteIndex(root: vscode.Uri): Error {
  return new Error(issue(root, 'Wiki file lookup is incomplete; use an explicit relative or vault path.', 'Wiki 文件查找未完成，请使用明确的相对路径或仓库路径。'));
}

/** findFiles only searches open workspaces; a standalone vault uses its filesystem provider. */
async function readVaultFiles(root: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const directories = [root];
  const files: vscode.Uri[] = [];
  let entriesRead = 0;
  while (directories.length) {
    if (cancellation.isCancellationRequested) throw incompleteIndex(root);
    const currentDirectory = directories.pop()!;
    for (const [name, type] of await vscode.workspace.fs.readDirectory(currentDirectory)) {
      if (++entriesRead > MAX_INDEX_FILES) throw incompleteIndex(root);
      // Never follow directory symlinks out of the vault or into a traversal cycle.
      if (type & vscode.FileType.Directory) {
        if (!ignoredDirectories.has(name) && !(type & vscode.FileType.SymbolicLink)) directories.push(vscode.Uri.joinPath(currentDirectory, name));
      } else if (type & vscode.FileType.File) files.push(vscode.Uri.joinPath(currentDirectory, name));
    }
  }
  return files;
}

const fold = (value: string, uri: vscode.Uri) => uri.scheme === 'file' && process.platform === 'win32' ? value.toLowerCase() : value;
const parent = (uri: vscode.Uri) => vscode.Uri.joinPath(uri, '..');
async function isFile(uri: vscode.Uri): Promise<boolean> {
  try { return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) !== 0; } catch { return false; }
}
async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try { return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0; } catch { return false; }
}

function rootFor(document: vscode.Uri): Promise<WikiRoot> {
  const directory = parent(document);
  const key = directory.toString();
  let pending = roots.get(key);
  if (!pending) {
    pending = (async () => {
      let cursor = directory;
      for (;;) {
        if (await isDirectory(vscode.Uri.joinPath(cursor, '.obsidian'))) return { uri: cursor, obsidian: true };
        const next = parent(cursor);
        if (next.path === cursor.path) break;
        cursor = next;
      }
      return { uri: vscode.workspace.getWorkspaceFolder(document)?.uri ?? directory, obsidian: false };
    })();
    roots.set(key, pending);
  }
  return pending;
}

function invalidate(entry: FileIndex, namesChanged = true): void {
  if (namesChanged) {
    entry.cancellation?.cancel();
    entry.files = undefined;
    roots.clear();
  }
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = undefined;
    for (const listener of listeners) listener();
  }, 100);
}

function fileIndexFor(root: vscode.Uri): FileIndex {
  const key = root.toString();
  let entry = indexes.get(key);
  if (!entry) {
    entry = {};
    indexes.set(key, entry);
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    entry.watcher = watcher;
    const current = entry;
    const relevant = (uri: vscode.Uri) => !/(?:^|\/)(?:\.git|node_modules|dist|\.cache)(?:\/|$)/.test(uri.path.slice(root.path.length));
    watcher.onDidCreate(uri => { if (relevant(uri)) invalidate(current); });
    watcher.onDidDelete(uri => { if (relevant(uri)) invalidate(current); });
    // Content changes do not affect filename lookup. Refresh only changed images.
    watcher.onDidChange(uri => { if (relevant(uri) && isWikiImageTarget(uri.path)) invalidate(current, false); });
  }
  return entry;
}

async function indexedFiles(root: vscode.Uri): Promise<WikiFileIndex> {
  const generation = lifetime;
  const entry = fileIndexFor(root);
  if (!entry.files) {
    const current = entry;
    const cancellation = new vscode.CancellationTokenSource();
    current.cancellation = cancellation;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { cancellation.cancel(); reject(incompleteIndex(root)); }, 5000);
    });
    const search = vscode.workspace.getWorkspaceFolder(root) ? vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/*'), '**/{.git,node_modules,dist,.cache,.obsidian}/**', MAX_INDEX_FILES + 1, cancellation.token
    ) : readVaultFiles(root, cancellation.token);
    const pending = Promise.race([search, timeout]).then(files => {
      if (cancellation.token.isCancellationRequested || files.length > MAX_INDEX_FILES) {
        throw incompleteIndex(root);
      }
      const prefix = fold(`${root.path.replace(/\/$/, '')}/`, root);
      const scoped = files.filter(uri => uri.scheme === root.scheme && uri.authority === root.authority && fold(uri.path, root).startsWith(prefix));
      const byName = new Map<string, vscode.Uri[]>();
      for (const uri of scoped) {
        const name = fold(uri.path.split('/').at(-1)!, root);
        const candidates = byName.get(name) ?? [];
        candidates.push(uri);
        byName.set(name, candidates);
      }
      return { files: scoped, byName };
    }).finally(() => { clearTimeout(timer!); cancellation.dispose(); if (current.cancellation === cancellation) current.cancellation = undefined; });
    current.files = pending;
    pending.catch(() => { if (current.files === pending) current.files = undefined; });
  }
  const pending = entry.files!;
  const files = await pending;
  if (generation !== lifetime) throw new Error('Wiki lookup cancelled / Wiki 文件查找已取消');
  return entry.files === pending ? files : indexedFiles(root);
}

/** Explicit paths bypass the index. Short names must resolve uniquely within one vault. */
export async function resolveWikiResource(rawTarget: string, document: vscode.Uri): Promise<WikiResourceResolution> {
  const generation = lifetime;
  const hash = rawTarget.indexOf('#');
  const fragment = hash < 0 ? '' : rawTarget.slice(hash + 1);
  const target = (hash < 0 ? rawTarget : rawTarget.slice(0, hash)).trim().replaceAll('\\', '/');
  const withFragment = (uri: vscode.Uri): WikiResourceResolution => ({ uri: fragment ? uri.with({ fragment }) : uri });
  if (!target) return withFragment(document);
  const absolute = /^[a-z]:\//i.test(target) || target.startsWith('/');
  if (/^file:/i.test(target) || absolute) {
    try {
      const uri = /^file:/i.test(target) ? vscode.Uri.parse(target, true)
        : document.scheme === 'file' ? vscode.Uri.file(target) : document.with({ path: target, query: '', fragment: '' });
      return await isFile(uri) ? withFragment(uri) : {};
    } catch { return {}; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return {};
  const variants = /\.[^/]+$/.test(target) ? [target] : [...markdownExtensions.map(ext => `${target}${ext}`), target];
  const documentDirectory = parent(document);
  const findDirect = async (directory: vscode.Uri) => {
    for (const variant of variants) {
      const uri = vscode.Uri.joinPath(directory, variant);
      if (await isFile(uri)) return withFragment(uri);
    }
    return null;
  };
  const root = await rootFor(document);
  if (generation !== lifetime) return {};
  fileIndexFor(root.uri);
  if (/^\.\.?\//.test(target)) return await findDirect(documentDirectory) ?? {};
  // A path containing folders has explicit candidates; bare names use the unique-name index.
  if (target.includes('/')) {
    for (const directory of root.obsidian ? [root.uri, documentDirectory] : [documentDirectory, root.uri]) {
      const direct = await findDirect(directory);
      if (direct) return direct;
    }
  }
  try {
    const index = await indexedFiles(root.uri);
    const suffixes = variants.map(variant => `/${fold(variant, root.uri)}`);
    const matches = target.includes('/') ? index.files.filter(uri => suffixes.some(suffix => fold(uri.path, root.uri).endsWith(suffix)))
      : variants.flatMap(variant => index.byName.get(fold(variant, root.uri)) ?? []);
    if (matches.length === 1) return withFragment(matches[0]);
    if (matches.length > 1) {
      const candidates = matches.map(uri => uri.path.slice(root.uri.path.replace(/\/$/, '').length + 1)).sort();
      return { candidates, issue: `${issue(root.uri, 'Multiple Wiki targets; specify the path:', 'Wiki 目标重名，请补全路径：')}\n${candidates.slice(0, 10).join('\n')}` };
    }
    return {};
  } catch (error) {
    return { issue: error instanceof Error ? error.message : 'Wiki file lookup failed / Wiki 文件查找失败' };
  }
}

export async function resolveDocumentWikiResources(text: string, document: vscode.Uri): Promise<ResolvedWikiResources> {
  const targets = [...new Set(collectWikiReferences(text)
    .filter(reference => (!reference.embed || isWikiImageTarget(reference.target))
      && (!/^[a-z][a-z0-9+.-]*:/i.test(reference.target) || /^(?:file:|[a-z]:[\\/])/i.test(reference.target)))
    .map(reference => reference.target))];
  const resources: ResolvedWikiResources = Object.create(null);
  await Promise.all(targets.map(async target => {
    const result = await resolveWikiResource(target, document);
    resources[target] = result.uri ? { uri: result.uri.toString() } : { issue: result.issue ?? issue(document, 'Wiki target not found', 'Wiki 目标不存在') };
  }));
  return resources;
}

export function onDidChangeWikiResources(listener: () => void): vscode.Disposable {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}

export function disposeWikiResources(): void {
  lifetime++;
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = undefined;
  for (const entry of indexes.values()) {
    entry.cancellation?.cancel();
    entry.watcher?.dispose();
  }
  indexes.clear();
  roots.clear();
  listeners.clear();
}
