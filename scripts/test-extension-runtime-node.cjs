const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-extension-installed-'));
const installedEntryPath = path.join(installRoot, 'extension.js');
const originalLoad = Module._load;

try {
  fs.copyFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), installedEntryPath);
  // VS Code supplies this external module; every other dependency must be bundled.
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  const extension = require(installedEntryPath);
  assert.equal(typeof extension.activate, 'function');
  console.log('Installed extension entry loads in Node without development dependencies.');
} finally {
  Module._load = originalLoad;
  fs.rmSync(installRoot, { recursive: true, force: true });
}
