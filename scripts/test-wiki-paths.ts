import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { URI, Utils } from 'vscode-uri';

// URI fixtures exercise both path styles on every CI host without relying on os.tmpdir().
const entries = new Map<string, number>();
let root: URI;
mock.module('vscode', () => ({
  Uri: { file: URI.file, parse: URI.parse, joinPath: Utils.joinPath },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  env: { language: 'en' },
  RelativePattern: class { constructor(readonly baseUri: URI, readonly pattern: string) {} },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    getWorkspaceFolder: () => ({ uri: root }),
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate() {}, onDidDelete() {}, onDidChange() {} }),
    fs: { stat: async (uri: URI) => {
      const type = entries.get(uri.toString());
      if (type === undefined) throw new Error('File not found');
      return { type };
    } }
  }
}));
const { resolveWikiResource, resolveDocumentWikiResources, disposeWikiResources } = await import('../src/host/wikiResources');

for (const rootPath of ['/tmp/meo-wiki-paths/vault', 'C:/meo-wiki-paths/vault']) {
  root = URI.file(rootPath);
  const document = Utils.joinPath(root, 'notes/note.md');
  entries.clear();
  entries.set(Utils.joinPath(root, '.obsidian').toString(), 2);
  try {
    for (const name of ['plain.png', '图片 50%🖼️.png', '字面%E8%AE%BE.png']) {
      const image = Utils.joinPath(root, 'assets', name);
      const localImage = Utils.joinPath(root, 'notes/assets', name);
      const outsideImage = URI.file(`/assets/${name}`);
      for (const uri of [image, localImage, outsideImage]) entries.set(uri.toString(), 1);
      const cases: Array<[string, URI]> = [
        [`/assets/${name}`, image],
        [`assets/${name}`, image],
        [`./assets/${name}`, localImage],
        [`../assets/${name}`, image],
        [image.toString(), image],
        [outsideImage.toString(), outsideImage]
      ];
      if (/^[a-z]:/i.test(rootPath)) {
        const drivePath = `${rootPath}/assets/${name}`;
        cases.push([drivePath, image], [drivePath.replaceAll('/', '\\'), image]);
      } else {
        // A leading slash stays vault-root syntax even when that OS file exists.
        const rawPath = `${rootPath}/assets/${name}`;
        assert.deepEqual(await resolveWikiResource(rawPath, document as never), {});
        const unresolved = await resolveDocumentWikiResources(`[[${rawPath}]]\n![[${rawPath}]]`, document as never);
        assert.equal(unresolved[rawPath].uri, undefined);
        assert.match(unresolved[rawPath].issue!, /not found/);
      }
      for (const [target, expected] of cases) {
        assert.equal((await resolveWikiResource(target, document as never)).uri?.toString(), expected.toString(), target);
        const fragmentTarget = `${target}#Section`;
        assert.equal((await resolveWikiResource(fragmentTarget, document as never)).uri?.toString(), expected.with({ fragment: 'Section' }).toString());
      }
      const resources = await resolveDocumentWikiResources(cases.map(([target]) => `[[${target}]]\n![[${target}]]`).join('\n'), document as never);
      for (const [target, expected] of cases) assert.equal(resources[target].uri, expected.toString(), `document resource: ${target}`);
      entries.delete(image.toString());
      assert.deepEqual(await resolveWikiResource(`/assets/${name}`, document as never), {}, 'missing vault files cannot fall back to an OS-root file');
    }
  } finally {
    disposeWikiResources();
  }
}
console.log('Wiki POSIX/Windows URI fixtures: vault roots, relative paths, file URIs, drive paths, fragments and document resources passed');
