import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { nodeRuntimeBuildOptions } from './build-puppeteer-runtime.mjs';
import { assertPackageTextIsPublic } from './vsix-privacy';

const repoRoot = resolve(import.meta.dir, '..');
const runtime = readFileSync(resolve(repoRoot, 'dist/puppeteer-runtime.js'), 'utf8');
assertPackageTextIsPublic('dist/puppeteer-runtime.js', runtime, repoRoot);
// Exercise the dependency that embeds QuickJS/WASM with the production build
// configuration. Puppeteer import alone does not compile a PAC resolver.
const pac = await Bun.build({
  ...nodeRuntimeBuildOptions,
  entrypoints: [createRequire(import.meta.url).resolve('pac-proxy-agent')]
});
assert.ok(pac.success, 'PAC dependency must build with the production configuration');
const pacRuntime = await pac.outputs[0]!.text();
assertPackageTextIsPublic('pac-runtime.cjs', pacRuntime, repoRoot);
const probe = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const bundles = JSON.parse(fs.readFileSync(0, 'utf8'));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  assert.ok(Module.isBuiltin(request), 'Installed runtime requested an unbundled dependency: ' + request);
  return originalLoad.call(this, request, parent, isMain);
};
function loadInstalled(contents, name) {
  const filename = path.join(os.tmpdir(), 'meo-relocated-runtime', 'dist', name);
  const installed = new Module(filename);
  installed.filename = filename;
  installed.paths = [];
  installed._compile(contents, filename);
  return installed.exports;
}
async function main() {
  const puppeteer = loadInstalled(bundles.puppeteer, 'puppeteer-runtime.js').default;
  assert.equal(typeof puppeteer.launch, 'function');
  const { PacProxyAgent } = loadInstalled(bundles.pac, 'pac-runtime.cjs');
  const script = 'function FindProxyForURL(url, host) { return host === "example.invalid" ? "DIRECT" : "PROXY localhost:8080"; }';
  const agent = new PacProxyAgent('data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(script).toString('base64'));
  try {
    const resolver = await agent.getResolver();
    assert.equal(await resolver('https://example.invalid/', 'example.invalid'), 'DIRECT');
    assert.equal(await resolver('https://other.invalid/', 'other.invalid'), 'PROXY localhost:8080');
  } finally { agent.destroy(); }
  console.log('Relocated Puppeteer import and QuickJS/WASM PAC resolution passed in Node without development dependencies.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;
const result = spawnSync('node', ['-e', probe], {
  input: JSON.stringify({ puppeteer: runtime, pac: pacRuntime }),
  encoding: 'utf8',
  timeout: 30_000,
  env: { ...process.env, NODE_PATH: '' }
});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log(result.stdout.trim());
