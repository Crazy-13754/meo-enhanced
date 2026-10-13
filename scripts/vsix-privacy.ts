import { pathToFileURL } from 'node:url';

export function assertPackageTextIsPublic(file: string, contents: string, repoRoot: string): void {
  const checkoutPaths = [repoRoot, repoRoot.replaceAll('\\', '/'), pathToFileURL(repoRoot).href]
    .flatMap(value => [value, JSON.stringify(value).slice(1, -1)]);
  // Escaped separators and file URLs can hide the same path in generated JS or JSON.
  const normalized = contents.replace(/%(2f|5c|3a)/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  const personalDirectory = /(?:[a-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+)[\\/]+/i;
  if (checkoutPaths.some(value => contents.includes(value)) || personalDirectory.test(normalized)) {
    throw new Error(`Package contains a private build or home path: ${file}`);
  }
  const credential = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/;
  if (credential.test(contents)) {
    // Report only the file: rejected credentials must never enter test logs.
    throw new Error(`Package contains a credential: ${file}`);
  }
}
