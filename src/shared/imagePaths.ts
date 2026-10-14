import * as path from 'node:path';

export function canResolveImageFromRoot(decodedPath: string, paths: typeof path.posix = path): boolean {
  return Boolean(decodedPath) && !paths.isAbsolute(decodedPath)
    && !/^[a-z]:/i.test(decodedPath) && !/^\.\.?(?:[\\/]|$)/.test(decodedPath);
}

/** Input is decoded once by the caller. Explicit ./ and ../ paths retain document scope. */
export function getImagePathCandidates(
  decodedPath: string,
  documentPath: string,
  searchRoots: readonly string[] = [],
  paths: typeof path.posix = path,
  workspaceRoot?: string
): string[] {
  const normalized = decodedPath.replace(/\\/g, paths.sep);
  if (decodedPath.startsWith('/') && !decodedPath.startsWith('//')) {
    return [paths.resolve(workspaceRoot ?? paths.dirname(documentPath), decodedPath.slice(1))];
  }
  const candidates = [paths.resolve(paths.dirname(documentPath), normalized)];
  if (!canResolveImageFromRoot(normalized, paths)) return candidates;
  for (const root of searchRoots) {
    const candidate = paths.resolve(root, normalized);
    const relative = paths.relative(root, candidate);
    // A bare path with embedded .. segments must not escape a fallback root.
    if (paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)) continue;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}
