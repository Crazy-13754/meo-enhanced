import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPreviewPresetLibrary, validatePresetCss, type StoredPreviewPreset } from '../src/host/customPreviewPresets';
import { createCustomPreviewPreset, decodeCustomPreviewPresets, parseCustomPreviewPresetManifest } from '../src/foundation/customPreviewPreset';
import { decodePreviewPresetState, getPreviewPreset, replaceCustomPreviewPresets, resolvePresetAppearance, resolvePreviewPresetSettings } from '../src/foundation/previewPresets';
import { decodePreviewPresetsChanged } from '../src/protocol/previewPresets';
import { decodePreviewRenderRequest } from '../src/protocol/previewRender';
import exportRuntime from '../src/export/runtime';

const saved = new Map<string, unknown>();
let failWrite = false;
let writes = 0;
const storage = { list: async () => [...saved.keys()], read: async (id: string) => saved.get(id)!, write: async (id: string, value: StoredPreviewPreset) => { if (failWrite) throw new Error('Disk unavailable'); writes++; saved.set(id, structuredClone(value)); }, remove: async (id: string) => { saved.delete(id); } };
const library = createPreviewPresetLibrary(storage);
const importExample = async (name: string) => {
  const directory = path.resolve('docs/examples/preview-presets', name);
  return library.import(await readFile(path.join(directory, 'preset.jsonc'), 'utf8'), file => readFile(path.join(directory, file), 'utf8'));
};
const dual = await importExample('paper-notes');
const single = await importExample('github-paper');
assert.equal((saved.get('paper-notes') as StoredPreviewPreset).files['common.css'], await readFile(path.resolve('docs/examples/preview-presets/paper-notes/common.css'), 'utf8'), 'Stored CSS preserves its actual line breaks');
assert.equal(library.list().length, 2);
assert.equal(dual.renderer, 'meo');
assert.equal(single.renderer, 'meo');
assert.equal(single.controls.htmlComments.mode, 'editable');
assert.deepEqual(single.controls.codeColoring, { mode: 'fixed', value: true });
assert.equal(dual.controls.codeColoring.mode, 'editable', 'A named palette does not lock coloring');
assert.equal(resolvePresetAppearance(dual, 'auto', 'dark'), 'dark');
assert.equal(resolvePresetAppearance(single, 'dark', 'dark'), 'light');
assert.equal(single.controls.appearance.mode, 'fixed');
assert.equal(dual.controls.fontFamily.mode, 'fixed');
assert.deepEqual(decodeCustomPreviewPresets(library.list()), library.list());
assert.ok(decodePreviewPresetsChanged({ type: 'previewPresetsChanged', presets: library.list(), selected: dual.id }));
assert.equal(decodePreviewPresetsChanged({ type: 'previewPresetsChanged', presets: library.list(), selected: 'user:missing' }), null);
replaceCustomPreviewPresets(library.list());
assert.equal(getPreviewPreset('default').custom, undefined);
const preference = { preset: single.id, preferences: { [single.id]: { appearance: 'dark', contentWidth: 'reference' } } };
assert.equal(decodePreviewPresetState(preference)?.preferences[single.id]?.appearance, 'light');
assert.ok(decodePreviewRenderRequest({ type: 'requestPreviewRender', requestId: 'custom', text: '# Test', uiLanguage: 'en', environment: { previewFontFamily: '' }, preset: dual.id, presetRevision: dual.custom!.revision }));
assert.equal(decodePreviewRenderRequest({ type: 'requestPreviewRender', requestId: 'custom', text: '# Test', uiLanguage: 'en', environment: { previewFontFamily: '' }, preset: dual.id, presetRevision: 'invalid' }), null);

const basic = { schemaVersion: 1, id: 'test-style', name: 'Test', description: 'Example', themes: { light: { css: 'light.css' } } };
for (const value of [
  { ...basic, themes: {} }, { ...basic, base: 'user:paper-notes' }, { ...basic, id: '../escape' },
  { ...basic, themes: { light: { css: '../escape.css' } } }, { ...basic, themes: { light: { css: 'C:/escape.css' } } },
  { ...basic, themes: { light: { css: 'light.css', codeTheme: 'unknown' } } },
  ...[null, [], { unknown: {} }, { htmlComments: {} }, { htmlComments: { mode: 'unsupported' } },
    { htmlComments: { mode: 'editable', value: true } }, { codeColoring: { mode: 'fixed' } },
    { codeColoring: { mode: 'fixed', value: 'false' } }, { codeColoring: { mode: 'fixed', value: true, extra: 1 } }
  ].map(controls => ({ ...basic, controls }))
]) assert.throws(() => parseCustomPreviewPresetManifest(value));
assert.deepEqual(parseCustomPreviewPresetManifest({ ...basic, controls: {} }).controls, {});
for (const base of ['default', 'github-readme'] as const) {
  for (const controls of [undefined, { htmlComments: { mode: 'editable' }, codeColoring: { mode: 'editable' } },
    { htmlComments: { mode: 'fixed', value: true }, codeColoring: { mode: 'fixed', value: false } },
    { htmlComments: { mode: 'fixed', value: false }, codeColoring: { mode: 'fixed', value: true } }]) {
    const manifest = parseCustomPreviewPresetManifest({ ...basic, base, controls, themes: { light: { css: 'light.css', codeTheme: 'light-plus' } } });
    const preset = createCustomPreviewPreset(manifest, { light: ':root { --meo-bg: #fafafa; }' }, 'a'.repeat(64));
    assert.equal(preset.renderer, 'meo');
    assert.deepEqual(decodeCustomPreviewPresets([preset]), [preset], 'Control policies survive protocol decoding');
    assert.equal(decodeCustomPreviewPresets([{ ...preset, controls: { ...preset.controls, codeColoring: { mode: 'fixed' } } }]), null);
    for (const userValue of [true, false]) {
      const settings = resolvePreviewPresetSettings(preset.id, { previewFontFamily: '', previewShowComments: userValue, previewSourceColoring: userValue }, preset);
      const comments = preset.controls.htmlComments.mode === 'editable' ? userValue : preset.controls.htmlComments.value;
      const coloring = preset.controls.codeColoring.mode === 'editable' ? userValue : preset.controls.codeColoring.value;
      assert.equal(settings.previewShowComments, comments);
      assert.equal(settings.previewSourceColoring, coloring);
      const markdownText = 'first\nsecond\n\n<!-- visible preset comment -->\n\n```typescript\nconst answer = 42;\n```';
      const environment = { previewFontFamily: '', previewShowComments: userValue, previewSourceColoring: userValue };
      const preview = exportRuntime.renderPreviewDocument({ markdownText, sourceDocumentPath: 'C:/tmp/test.md', uiLanguage: 'en', styleEnvironment: environment, preset: preset.id, presetDefinition: preset });
      assert.equal(preview.html.includes('visible preset comment'), comments);
      assert.match(preview.html, /<br(?:\s|>)/, 'Both style bases use MEO line breaks');
      for (const target of ['html', 'pdf'] as const) {
        const result = await exportRuntime.renderExportHtmlDocument({ readingSnapshot: { snapshotId: 'controls', text: markdownText, appearance: 'light', uiLanguage: 'en', environment, preset: preset.id, presetRevision: preset.custom!.revision }, presetDefinition: preset,
          sourceDocumentPath: 'C:/tmp/test.md', outputFilePath: `C:/tmp/test.${target}`, target, mermaidRuntimeSrc: '', baseHref: '', title: 'Controls', shikiLanguageAssetsRoot: path.resolve('webview/dist') });
        assert.equal(result.htmlDocument.includes('visible preset comment'), comments, `${base}: ${target} honors comments`);
        assert.equal(/<span[^>]+style="color:/i.test(result.htmlDocument), coloring, `${base}: ${target} honors coloring even with a named palette`);
        if (base === 'github-readme') assert.ok(result.htmlDocument.includes('class="meo-export-doc markdown-body"'), 'GitHub CSS remains active in exports');
      }
    }
  }
}
const builtinGithub = exportRuntime.renderPreviewDocument({ markdownText: 'first\nsecond\n\n<!-- visible preset comment -->', sourceDocumentPath: 'C:/tmp/test.md', uiLanguage: 'en', styleEnvironment: { previewFontFamily: '', previewShowComments: true }, preset: 'github-readme' });
assert.ok(!builtinGithub.html.includes('visible preset comment') && !/<br(?:\s|>)/.test(builtinGithub.html), 'Built-in GitHub retains its rendering rules');
for (const css of [
  'body { background: red; }', '.toolbar { color: red; }', '.meo-export-doc + div { color: red; }',
  '@import "remote.css";', '@font-face { font-family: test; src: url(font.woff2); }',
  '.meo-export-doc { background: url(https://example.com/image.png); }',
  String.raw`.meo-export-doc { background: \75rl(secret.png); }`,
  '.meo-export-doc { h1 { color: red; } }', '.meo-export-doc { color: red;'
]) assert.throws(() => validatePresetCss(css, 'invalid.css'));
assert.ok(validatePresetCss('@media (max-width: 600px) { .meo-export-doc :is(th, td) { padding: 8px; } }', 'valid.css'));

const before = saved.get('paper-notes');
await assert.rejects(library.import(JSON.stringify({ ...basic, id: 'paper-notes' }), async () => 'body { color: red; }'));
await assert.rejects(library.import('{ invalid JSON }', async () => ''));
await assert.rejects(library.import(JSON.stringify({ ...basic, id: 'paper-notes' }), async () => { throw new Error('Missing CSS'); }));
failWrite = true;
await assert.rejects(library.import(JSON.stringify({ ...basic, id: 'paper-notes' }), async () => '.meo-export-doc { color: red; }'));
failWrite = false;
assert.ok(library.diagnostics().some(issue => issue.preset === dual.id && issue.message === 'Disk unavailable'));
assert.equal(saved.get('paper-notes'), before);
assert.equal(library.get(dual.id), dual);
const beforeReload = writes;
const restarted = createPreviewPresetLibrary(storage);
assert.deepEqual(await restarted.load(), []);
assert.deepEqual(restarted.list(), library.list(), 'Saved packages restore identical styles and revisions without original files');
assert.equal(writes, beforeReload, 'Loading complete packages does not rewrite their contents');
failWrite = true;
const readOnlyLibrary = createPreviewPresetLibrary(storage);
assert.deepEqual(await readOnlyLibrary.load(), []);
assert.deepEqual(readOnlyLibrary.list(), library.list(), 'Read-only storage can still load saved packages');
failWrite = false;
assert.deepEqual(await restarted.load(), []);

const environment = { previewFontFamily: 'Georgia', previewSourceColoring: true, editorBackgroundColor: '#23272b' };
const text = '# Test\n\n> [!NOTE]\n> Note\n\n```typescript\nconst value = 42;\n```';
const preview = exportRuntime.renderPreviewDocument({ markdownText: text, sourceDocumentPath: 'C:/tmp/test.md', uiLanguage: 'en', styleEnvironment: environment, preset: dual.id, presetDefinition: dual });
assert.equal(preview.presetRevision, dual.custom!.revision);
const options = { readingSnapshot: { snapshotId: 'custom', text, appearance: 'dark' as const, uiLanguage: 'en' as const, environment, preset: dual.id, presetRevision: dual.custom!.revision }, presetDefinition: dual, sourceDocumentPath: 'C:/tmp/test.md', outputFilePath: 'C:/tmp/test.html', target: 'html' as const, mermaidRuntimeSrc: '', baseHref: '', title: 'Test', shikiLanguageAssetsRoot: path.resolve('webview/dist') };
const exporting = exportRuntime.renderExportHtmlDocument(options);
const updated = await library.import(JSON.stringify({ ...basic, id: 'paper-notes' }), async () => ':root { --meo-bg: #eeeeee; }');
assert.ok(!library.diagnostics().some(issue => issue.preset === dual.id), 'Successful updates clear the preset error');
assert.notEqual(updated.custom!.revision, dual.custom!.revision);
const html = await exporting;
assert.ok(html.htmlDocument.includes(preview.styles.dark), 'Export freezes the exact Preview style before updates');
assert.ok(!html.htmlDocument.includes('--meo-bg: #eeeeee'));
const word = await exportRuntime.renderExportHtmlDocument({ ...options, target: 'docx' });
assert.ok(word.htmlDocument.includes('--meo-bg: #ffffff'));
assert.ok(!word.htmlDocument.includes('--paper-accent') && !word.htmlDocument.includes('paper-notes'));
const githubPreview = exportRuntime.renderPreviewDocument({ markdownText: text, sourceDocumentPath: 'C:/tmp/test.md', uiLanguage: 'en', preset: single.id, presetDefinition: single });
assert.ok(githubPreview.html.includes('meo-export-alert-note'));
assert.equal(githubPreview.styles.dark, githubPreview.styles.light, 'Single-theme presets use the supported style in every pipeline');
await library.remove(single.id);
replaceCustomPreviewPresets(library.list());
assert.equal(decodePreviewPresetState(preference)?.preset, 'default');
saved.set('broken', {});
const invalidReload = createPreviewPresetLibrary(storage);
assert.equal((await invalidReload.load()).length, 1);
assert.deepEqual(invalidReload.diagnostics(), [{ preset: 'user:broken', message: 'broken: preset: expected an object' }]);
assert.ok(decodePreviewPresetsChanged({ type: 'previewPresetsChanged', presets: invalidReload.list(), diagnostics: invalidReload.diagnostics() }));
assert.equal(decodePreviewPresetsChanged({ type: 'previewPresetsChanged', presets: [], diagnostics: [{ preset: 'default', message: 'invalid' }] }), null);
assert.equal(invalidReload.list().length, 1);
assert.deepEqual(saved.get('broken'), {}, 'Invalid records are not rewritten');
replaceCustomPreviewPresets([]);
console.log('Custom preset import, persistence, recovery, CSS scope, theme support and frozen export checks passed.');
