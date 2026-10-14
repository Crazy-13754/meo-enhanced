import * as vscode from 'vscode';
import { posix } from 'node:path';
import { markdownFileExtensions } from '../foundation/markdownFileExtensions';
import { normalizeLinkDestination } from '../foundation/linkDestination';

/** A leading slash belongs to the document's workspace, including remote providers. */
export function markdownPathTarget(decodedPath: string, document: vscode.Uri): vscode.Uri {
  const normalized = decodedPath.replaceAll('\\', '/');
  if (/^[a-z]:\//i.test(normalized)) return document.scheme === 'file' ? vscode.Uri.file(normalized)
    : document.with({ path: '/' + normalized, query: '', fragment: '' });
  const root = normalized.startsWith('/') ? vscode.workspace.getWorkspaceFolder(document)?.uri : undefined;
  const basePath = root?.path ?? posix.dirname(document.path);
  return (root ?? document).with({ path: posix.resolve(basePath, normalized.startsWith('/') ? normalized.slice(1) : normalized), query: '', fragment: '' });
}

/** Existence checks and extension fallback are shared by navigation and heading lookup. */
export async function resolveMarkdownReference(rawHref: string, document: vscode.Uri): Promise<vscode.Uri | null> {
  const href = normalizeLinkDestination(rawHref);
  if (!href || href.startsWith('#') || href.startsWith('//')) return null;
  const rawPath = href.split(/[?#]/, 1)[0];
  const exists = async (uri: vscode.Uri) => { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } };
  if (/^file:/i.test(rawPath)) {
    try { const uri = vscode.Uri.parse(rawPath, true); return await exists(uri) ? uri : null; } catch { return null; }
  }
  let decoded = rawPath;
  try { decoded = decodeURIComponent(rawPath); } catch { /* Keep partially encoded destinations literal. */ }
  decoded = decoded.replaceAll('\\', '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) && !/^[a-z]:\//i.test(decoded)) return null;
  const find = async (base: vscode.Uri) => {
    const paths = posix.extname(decoded) ? [base.path] : [base.path, ...markdownFileExtensions.map(extension => base.path + extension)];
    for (const path of paths) { const uri = base.with({ path }); if (await exists(uri)) return uri; }
    return null;
  };
  const found = await find(markdownPathTarget(decoded, document));
  if (found || decoded.startsWith('/') || /^\.\.?\//.test(decoded) || /^[a-z]:\//i.test(decoded)) return found;
  const root = vscode.workspace.getWorkspaceFolder(document)?.uri;
  return root ? find(root.with({ path: posix.resolve(root.path, decoded), query: '', fragment: '' })) : null;
}
