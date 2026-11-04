import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { expandImageStorage, imageFileNameCandidates } from '../application/imageStorage';
import type { ImageStoragePreferences } from '../foundation/imageStorage';

export type ClipboardImageFileRequest = {
  readonly documentFsPath: string;
  readonly workspaceFsPath?: string;
  readonly configuredFolder?: string;
  readonly imageStorage?: ImageStoragePreferences;
  readonly extension: string;
  readonly contents: Uint8Array;
};

export type SavedClipboardImageFile = {
  readonly relativePath: string;
  readonly fileName: string;
};

export type ClipboardImageDirectoryRequest = Pick<ClipboardImageFileRequest,
  'documentFsPath' | 'workspaceFsPath' | 'configuredFolder' | 'imageStorage'>;

// Only pending saves are retained. Disk contents remain authoritative between pastes.
const pendingDirectorySaves = new Map<string, Promise<void>>();

/** Used by both settings previews and clipboard writes; resolving never creates directories. */
export function resolveClipboardImageDirectory(request: ClipboardImageDirectoryRequest) {
  const documentDirectory = path.dirname(path.resolve(request.documentFsPath));
  if (request.imageStorage) {
    const fileBasename = path.basename(request.documentFsPath);
    const fileExtname = path.extname(fileBasename);
    const expanded = expandImageStorage(request.imageStorage, {
      fileDirname: documentDirectory, fileBasename, fileExtname,
      fileBasenameNoExtension: fileBasename.slice(0, fileBasename.length - fileExtname.length)
    });
    if (expanded.includes('\0') || /^[a-z]:(?![\\/])/i.test(expanded)) {
      throw new Error('Enter a valid folder path.');
    }
    const targetDirectory = request.imageStorage.mode === 'advanced'
      ? path.resolve(documentDirectory, expanded)
      : resolveContainedPath(documentDirectory, expanded, 'Image folder');
    if (process.platform === 'win32') {
      for (const segment of targetDirectory.slice(path.parse(targetDirectory).root.length).split(path.sep)) {
        if (isUnsafeWindowsSegment(segment)) {
          throw new Error('The folder path contains a name that Windows cannot use.');
        }
      }
    }
    // An advanced rule explicitly authorizes its destination. Walk from the volume root
    // so a junction anywhere along that destination cannot silently redirect the write.
    const baseDirectory = request.imageStorage.mode === 'advanced'
      ? path.parse(targetDirectory).root : documentDirectory;
    return { documentDirectory, baseDirectory, targetDirectory };
  }
  const configuredFolder = request.configuredFolder?.trim();
  const baseDirectory = configuredFolder && request.workspaceFsPath
    ? path.resolve(request.workspaceFsPath) : documentDirectory;
  return { documentDirectory, baseDirectory,
    targetDirectory: resolveContainedPath(baseDirectory, configuredFolder || 'assets', 'Image folder') };
}

export async function saveClipboardImageFile(
  request: ClipboardImageFileRequest
): Promise<SavedClipboardImageFile> {
  const { documentDirectory, baseDirectory, targetDirectory } = resolveClipboardImageDirectory(request);
  // Validate before creating directories, then use the same naming rule as the preview.
  fileNameCandidates(request, []).next();

  if (baseDirectory !== path.parse(baseDirectory).root) await mkdir(baseDirectory, { recursive: true });
  // Bun omits the separator for Windows volume roots; retain an absolute root.
  const canonicalBaseDirectory = (await realpath(baseDirectory)).replace(/^([a-z]:)$/i, '$1' + path.sep);
  await ensureCanonicalDirectory(canonicalBaseDirectory, baseDirectory, targetDirectory);
  return withImageDirectoryLock(await realpath(targetDirectory), async () => {
    await ensureCanonicalDirectory(canonicalBaseDirectory, baseDirectory, targetDirectory);
    const entries = await readdir(targetDirectory, { withFileTypes: true });
    const matchingNames = entries.filter(entry => entry.isFile()
      && normalizedImageExtension(path.extname(entry.name).slice(1)) === normalizedImageExtension(request.extension))
      .map(entry => entry.name).sort();
    for (const fileName of matchingNames) {
      const imagePath = resolveContainedPath(targetDirectory, fileName, 'Image file name');
      if (await imageFileMatches(imagePath, request.contents)) {
        await ensureCanonicalDirectory(canonicalBaseDirectory, baseDirectory, targetDirectory);
        return { relativePath: path.relative(documentDirectory, imagePath).replace(/\\/g, '/'), fileName };
      }
    }

    const candidates = fileNameCandidates(request, entries.map(entry => entry.name));
    for (const candidateName of candidates) {
      const candidatePath = resolveContainedPath(targetDirectory, candidateName, 'Image file name');
      let handle;
      try {
        await ensureCanonicalDirectory(canonicalBaseDirectory, baseDirectory, targetDirectory);
        handle = await open(
          candidatePath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0)
        );
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          continue;
        }
        throw error;
      }

      try {
        await handle.writeFile(request.contents);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(candidatePath).catch(() => undefined);
        throw error;
      }
      await handle.close();
      return {
        relativePath: path.relative(documentDirectory, candidatePath).replace(/\\/g, '/'), fileName: candidateName
      };
    }
    throw new Error('No available image file name.');
  });
}

async function withImageDirectoryLock<T>(directory: string, save: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const result = (pendingDirectorySaves.get(key) ?? Promise.resolve()).then(save);
  const settled = result.then(() => undefined, () => undefined);
  pendingDirectorySaves.set(key, settled);
  try {
    return await result;
  } finally {
    if (pendingDirectorySaves.get(key) === settled) pendingDirectorySaves.delete(key);
  }
}

function normalizedImageExtension(extension: string): string {
  return extension.toLowerCase().replace(/^jpeg$/, 'jpg').replace(/^tiff$/, 'tif');
}

async function imageFileMatches(imagePath: string, contents: Uint8Array): Promise<boolean> {
  try {
    const before = await lstat(imagePath);
    if (!before.isFile() || before.size !== contents.byteLength) return false;
    const handle = await open(imagePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameImageFile(before, opened)) return false;
      const chunk = Buffer.allocUnsafe(Math.min(contents.byteLength, 64 * 1024));
      let offset = 0;
      while (offset < contents.byteLength) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, contents.byteLength - offset), offset);
        if (!bytesRead || !chunk.subarray(0, bytesRead).equals(contents.subarray(offset, offset + bytesRead))) return false;
        offset += bytesRead;
      }
      const after = await lstat(imagePath);
      return after.isFile() && sameImageFile(opened, await handle.stat()) && sameImageFile(opened, after);
    } finally {
      await handle.close();
    }
  } catch (error) {
    // An unrelated unreadable, removed or replaced candidate must not prevent a new image save.
    if (typeof error === 'object' && error !== null && 'code' in error
      && ['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(String(error.code))) return false;
    throw error;
  }
}

function sameImageFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function fileNameCandidates(request: ClipboardImageDirectoryRequest & { readonly extension: string }, existingNames: readonly string[]) {
  return imageFileNameCandidates({ naming: request.imageStorage?.naming ?? 'documentSequence',
    documentName: path.parse(request.documentFsPath).name, extension: request.extension,
    timestamp: Date.now(), existingNames });
}

/** A non-reserving PNG example; neither previews nor opening settings create directories. */
export async function previewClipboardImagePath(request: ClipboardImageDirectoryRequest): Promise<string> {
  const { targetDirectory } = resolveClipboardImageDirectory(request);
  const names = await readdir(targetDirectory).catch(error => {
    if (isNotFoundError(error)) return [];
    throw error;
  });
  return path.join(targetDirectory, fileNameCandidates({ ...request, extension: 'png' }, names).next().value!);
}

async function ensureCanonicalDirectory(
  canonicalBaseDirectory: string,
  baseDirectory: string,
  targetDirectory: string
): Promise<void> {
  const relative = path.relative(baseDirectory, targetDirectory);
  let current = baseDirectory;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await mkdir(current).catch(error => { if (!isAlreadyExistsError(error)) throw error; });
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink()) {
      throw new Error('Image folder must not traverse a symbolic link or junction');
    }
    if (!entry.isDirectory()) {
      throw new Error('Image folder must contain only directories');
    }
    assertContainedPath(canonicalBaseDirectory, await realpath(current), 'Image folder');
  }
}

function isUnsafeWindowsSegment(value: string): boolean {
  return /[<>:"|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}

function resolveContainedPath(root: string, relativePath: string, label: string): string {
  if (!relativePath || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || /^[a-z]:/i.test(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const target = path.resolve(root, relativePath);
  assertContainedPath(root, target, label);
  return target;
}

function assertContainedPath(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside its configured root`);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
