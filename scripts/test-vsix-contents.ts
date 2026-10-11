import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(import.meta.dir, '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  main?: string;
};
const output = execFileSync(
  process.execPath,
  ['x', 'vsce', 'ls', '--no-dependencies'],
  { cwd: repoRoot, encoding: 'utf8' }
);
const files = output
  .split(/\r?\n/)
  .map((entry) => entry.trim().replaceAll('\\', '/').replace(/^\.\//, ''))
  .filter(Boolean);
const included = new Set(files);

const requiredFiles = [
  'schemas/custom-preview-preset.schema.json',
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'logo.png',
  'dist/extension.js',
  'dist/export-runtime.js',
  'dist/docx-runtime.js',
  'dist/puppeteer-runtime.js',
  'webview/dist/index.js',
  'webview/dist/index.css',
  'webview/dist/mermaid.min.js',
  'webview/dist/package.json',
  'webview/dist/shiki-language-assets.json',
  'webview/dist/katex/katex.min.css'
];
for (const path of requiredFiles) {
  if (!included.has(path)) throw new Error(`VSIX listing is missing required file ${path}`);
}
const notices = readFileSync(resolve(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
for (const [dependency, licensePath] of [['jsonc-parser 3.3.1', 'jsonc-parser/LICENSE.md'], ['PostCSS 8.5.6', 'postcss/LICENSE']]) {
  if (!notices.includes(`## ${dependency}`)) throw new Error(`Bundled preset dependency is missing its license notice: ${dependency}`);
  const licenseText = readFileSync(resolve(repoRoot, 'node_modules', licensePath), 'utf8').trim().replaceAll('\r\n', '\n');
  if (!notices.replaceAll('\r\n', '\n').includes(licenseText)) throw new Error(`Bundled preset dependency license differs from the upstream notice: ${dependency}`);
}
const checkoutPathVariants = [repoRoot, repoRoot.replaceAll('\\', '/'), pathToFileURL(repoRoot).href]
  .flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]);
for (const path of ['dist/extension.js', 'dist/export-runtime.js', 'webview/dist/index.js']) {
  const contents = readFileSync(resolve(repoRoot, path), 'utf8');
  if (checkoutPathVariants.some((value) => contents.includes(value))) {
    throw new Error(`Production bundle contains the build checkout path: ${path}`);
  }
}

const main = packageJson.main?.replace(/^\.\//, '');
if (!main || !included.has(main)) {
  throw new Error('VSIX listing must contain the package main entry');
}
if (!files.some((path) => path.startsWith('webview/dist/katex/fonts/'))) {
  throw new Error('VSIX listing must contain KaTeX fonts');
}

const forbiddenPrefixes = [
  '.agents/',
  '.claude/',
  '.codex/',
  '.codegraph/',
  '.github/',
  '.local/',
  'node_modules/',
  'releases/',
  'scripts/',
  'src/',
  'tests/',
  'docs/',
  'preview-presets/',
  'webview/src/'
];
const forbiddenFile = /(?:^|\/)(?:\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|credentials[^/]*\.json|secrets?\.[^/]+|id_(?:rsa|ed25519)[^/]*)$/i;
for (const path of files) {
  if (
    forbiddenPrefixes.some((prefix) => path.startsWith(prefix))
    || forbiddenFile.test(path)
    || /\.(?:map|pem|key|p12|pfx|ts|vsix)$/i.test(path)
  ) {
    throw new Error(`VSIX listing contains forbidden file ${path}`);
  }
}

console.log(`VSIX content contract passed (${files.length} files)`);
