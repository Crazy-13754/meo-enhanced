import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';

export function hashPaths(paths: string[]): string {
  const hash = createHash('sha256');
  const activeDirectories = new Set<string>();
  const visit = (path: string): void => {
    hash.update(JSON.stringify(path));
    if (!existsSync(path)) { hash.update('missing'); return; }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) hash.update(JSON.stringify(readlinkSync(path)));
    const real = realpathSync(path);
    if (lstatSync(real).isDirectory()) {
      if (activeDirectories.has(real)) throw new Error(`Circular input directory: ${path}`);
      activeDirectories.add(real);
      for (const name of readdirSync(real).sort()) visit(join(path, name));
      activeDirectories.delete(real);
    } else {
      hash.update(readFileSync(real));
    }
  };
  paths.sort().forEach(visit);
  return hash.digest('hex');
}

// Any source/test/config/dependency change invalidates resume. This is not
// affected-test inference or a cross-machine result cache.
export function workflowFingerprint(root: string, browserPath: string): string {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8'
  }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  hash.update(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }));
  hash.update(execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root }));
  hash.update(hashPaths([...new Set(files)].map(file => resolve(root, file))));
  hash.update(hashPaths([
    join(root, 'node_modules'), join(root, 'webview/node_modules'),
    process.execPath, Bun.which('node') ?? '', browserPath
  ].filter(Boolean)));
  // Hash environment values rather than persisting credentials in reports.
  hash.update(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))));
  hash.update(JSON.stringify({ root, platform: process.platform, arch: process.arch,
    os: os.release(), host: os.hostname(), bun: Bun.version, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  return hash.digest('hex');
}

export function artifactFingerprint(root: string): string {
  return hashPaths([join(root, 'dist'), join(root, 'webview/dist')]);
}
