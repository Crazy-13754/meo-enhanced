import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DomUtils, parseDocument } from 'htmlparser2';
import exportRuntime from '../src/export/runtime';
import { rewriteExportLinkHref } from '../src/export/assetPaths';
import { createCustomPreviewPreset, parseCustomPreviewPresetManifest } from '../src/foundation/customPreviewPreset';
import { previewPresets } from '../src/foundation/previewPresets';

const custom = createCustomPreviewPreset(parseCustomPreviewPresetManifest({
  schemaVersion: 1, id: 'export-links', name: 'Export links', description: 'Link contract', base: 'github-readme',
  themes: { light: { css: 'light.css' }, dark: { css: 'dark.css' } }
}), { light: '', dark: '' }, 'a'.repeat(64));
const markdown = [
  '# Link audit', '[Slash](<D:/notes/local target 中文.md#part%2Fid>)',
  '[Backslash](<D:\\notes\\local target 中文.md#part%2Fid>)',
  '[Encoded separators](<D:%5Cnotes%5Clocal%20target%20中文.md#part%2Fid>)',
  '[File URI](file:///D:/notes/local%20target%20%E4%B8%AD%E6%96%87.md#part%2Fid)',
  '<a href="D:/notes/local%20target%20%E4%B8%AD%E6%96%87.md#part%2Fid">Raw local</a>',
  '[Workspace root](</docs/local target 中文.md?view=full#part%2Fid>)',
  '<a href="/docs/local target 中文.md?view=full#part%2Fid">Raw workspace root</a>',
  '[Web](https://example.com/path?q=a%20b#part%2Fid)', '[Mail](mailto:reader@example.com)',
  '[Section](#target)', '[Chinese](#中文标题)',
  '<span id="raw-id">Raw target</span> <a href="#raw-id">Raw section</a>',
  '[Footnote][^note]', '## Target', '## 中文标题', '[^note]: Footnote body',
  '<a href="javascript:alert(1)">Unsafe JS</a> <a href="vbscript:msgbox(1)">Unsafe VB</a>'
].join('\n\n');
const errors: string[] = [];
const workspaceRootPath = path.resolve('tmp/export-links/workspace');
assert.equal(rewriteExportLinkHref('/docs/local%20target.md#part', { markdownFilePath: path.resolve('tmp/export-links/source.md') }),
  `${pathToFileURL(path.resolve('tmp/export-links/docs/local target.md')).href}#part`, 'No workspace falls back to the document directory');
assert.equal(rewriteExportLinkHref('//example.com/docs', { markdownFilePath: 'source.md' }), '//example.com/docs', 'Protocol-relative links retain their authority');
for (const definition of [...previewPresets, custom]) {
  for (const target of ['html', 'pdf'] as const) {
    const output = path.resolve(`tmp/export-links/报告 %23 #1.${target}`);
    const rendered = await exportRuntime.renderExportHtmlDocument({
      readingSnapshot: { snapshotId: 'link-contract', text: markdown, appearance: 'light', uiLanguage: 'en', preset: definition.id,
        environment: { previewFontFamily: '', previewSourceColoring: false, previewShowComments: false } },
      presetDefinition: definition, sourceDocumentPath: path.resolve('tmp/export-links/source.md'), outputFilePath: output,
      workspaceRootPath,
      target, mermaidRuntimeSrc: '', baseHref: 'file:///export/', title: 'Link contract',
      shikiLanguageAssetsRoot: path.resolve('webview/dist'), includeTableOfContents: true
    });
    const doc = parseDocument(rendered.htmlDocument);
    const anchors = DomUtils.findAll(node => node.type === 'tag' && node.name === 'a', doc.children);
    const href = (label: string) => anchors.find(node => DomUtils.textContent(node) === label)?.attribs.href;
    const check = (label: string, verify: () => void) => {
      try { verify(); } catch (error) { errors.push(`${definition.id}/${target}/${label}: ${(error as Error).message.split('\n')[0]}`); }
    };
    for (const label of ['Slash', 'Backslash', 'Encoded separators', 'File URI', 'Raw local']) {
      check(label, () => assert.equal(href(label), 'file:///D:/notes/local%20target%20%E4%B8%AD%E6%96%87.md#part%2Fid'));
    }
    for (const label of ['Workspace root', 'Raw workspace root']) {
      check(label, () => assert.equal(href(label), `${pathToFileURL(path.join(workspaceRootPath, 'docs/local target 中文.md')).href}?view=full#part%2Fid`));
    }
    check('web', () => assert.equal(href('Web'), 'https://example.com/path?q=a%20b#part%2Fid'));
    check('mail', () => assert.equal(href('Mail'), 'mailto:reader@example.com'));
    const prefix = target === 'html' ? `./${encodeURIComponent(path.basename(output))}` : '';
    const github = definition.renderer === 'github-readme';
    for (const [label, id] of [['Section', 'target'], ['Chinese', '中文标题'], ['Raw section', github ? 'user-content-raw-id' : 'raw-id']]) {
      check(label, () => {
        const link = href(label);
        assert.ok(link?.startsWith(`${prefix}#`), `${link} must stay in its exported document`);
        assert.equal(decodeURIComponent(link!.slice(link!.indexOf('#') + 1)), id);
        assert.ok(DomUtils.findOne(node => node.type === 'tag' && node.attribs.id === id, doc.children));
      });
    }
    for (const anchor of anchors.filter(node => /(?:footnote|meo-export-toc)/.test(node.attribs.class ?? '') || node.attribs.id?.startsWith('fnref-'))) {
      check('generated anchor', () => {
        const link = anchor.attribs.href;
        assert.ok(target === 'html' ? link.includes(`${encodeURIComponent(path.basename(output))}#`) : link.startsWith('#'));
        const id = decodeURIComponent(link.slice(link.indexOf('#') + 1));
        assert.ok(DomUtils.findOne(node => node.type === 'tag' && node.attribs.id === id, doc.children));
      });
    }
    check('unsafe schemes', () => assert.ok(!anchors.some(node => /^(?:javascript|vbscript):/i.test(node.attribs.href ?? ''))));
  }
  const preview = exportRuntime.renderPreviewDocument({
    markdownText: markdown, sourceDocumentPath: path.resolve('tmp/export-links/source.md'), preset: definition.id,
    presetDefinition: definition, styleEnvironment: { previewFontFamily: '' }
  });
  const previewDoc = parseDocument(preview.html);
  const rootLink = DomUtils.findOne(node => node.type === 'tag' && node.name === 'a' && DomUtils.textContent(node) === 'Workspace root', previewDoc.children);
  assert.equal(rootLink?.attribs.href, '/docs/local%20target%20%E4%B8%AD%E6%96%87.md?view=full#part%2Fid', 'Preview keeps workspace paths for Host resolution');
}
assert.equal(errors.length, 0, `Export link contract failed:\n${errors.slice(0, 12).join('\n')}\n(${errors.length} failures)`);
console.log('Export links: all built-in/custom presets, local destinations, safe schemes and document anchors passed.');
