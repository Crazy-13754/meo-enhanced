import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import exportRuntime from '../src/export/runtime';
import { decodePreviewRenderRequest, decodePreviewRenderResponse } from '../src/protocol/previewRender';
import { decodePreviewPresetState, previewPresets, resolvePreviewPresetSettings } from '../src/foundation/previewPresets';
import { decodeExportSnapshotResponse } from '../src/protocol/exportSnapshot';

const environment = { previewFontFamily: 'Comic Sans MS', previewSourceColoring: false, previewShowComments: true };
const render = (markdownText: string, preset: 'default' | 'github-readme' = 'github-readme') => exportRuntime.renderPreviewDocument({
  markdownText, sourceDocumentPath: 'C:/tmp/preset.md', uiLanguage: 'zh-CN', styleEnvironment: environment, preset
});
const text = 'first\nsecond\n\n==highlight== H~2~O x^2^\n\n- [x] done\n- [~] doing\n- [-] cancelled\n\n<!-- secret note -->';
const github = render(text);
const original = render(text, 'default');
assert.ok(original.html.includes('<br'));
assert.ok(!github.html.includes('<br'));
assert.ok(original.html.includes('<mark>highlight</mark>') && original.html.includes('<sub>2</sub>'));
assert.ok(github.html.includes('==highlight== H<del>2</del>O x^2^'));
assert.equal((github.html.match(/meo-export-task-checkbox/g) ?? []).length, 1);
assert.equal((original.html.match(/meo-export-task-checkbox/g) ?? []).length, 3);
assert.ok(!github.html.includes('secret note'));
assert.ok(original.html.includes('secret note'));
assert.ok(!github.styles.light.includes('Comic Sans MS'));
assert.ok(original.styles.light.includes('Comic Sans MS'));
assert.ok(github.styles.light.includes('body { margin: 0; background: #ffffff'));
assert.ok(github.styles.dark.includes('body { margin: 0; background: #0d1117'));
const unsafeStyle = render('<div style="color:red" class="custom" id="custom">Content</div>').html;
assert.ok(!unsafeStyle.includes('color:red') && !unsafeStyle.includes('class="custom"') && !unsafeStyle.includes('id="custom"'));
const headings = render('# Repeat\n\n# Repeat\n\n# Repeat').html;
assert.ok(headings.includes('id="repeat-1"') && headings.includes('id="repeat-2"'));
assert.deepEqual([...render('# Repeat\n\n# Repeat-1\n\n# Repeat\n\n# Repeat-1').html.matchAll(/id="([^"]+)"/g)].map(match => match[1]), ['repeat', 'repeat-1', 'repeat-2', 'repeat-1-1']);
// These boundaries are verified against the private GitHub syntax-probes fixture.
const compatibilityFailures: string[] = [];
const checkCompatibility = (name: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) compatibilityFailures.push(`${name}: expected ${expected}, got ${actual}`);
};
checkCompatibility('GitHub punctuation anchor', render('# P16 · Anchor / punctuation').html.includes('id="p16--anchor--punctuation"'), true);
checkCompatibility('Default punctuation anchor', render('# P16 · Anchor / punctuation', 'default').html.includes('id="p16-anchor-punctuation"'), true);
checkCompatibility('GitHub heading with inline link and underscore', render('# Title  [link](https://example.com) and `raw_value` _italic_').html.includes('id="title--link-and-raw_value-italic"'), true);
checkCompatibility('GitHub heading with math', render('# P06 Heading with spaces $a+b$').html.includes('id="p06-heading-with-spaces-ab"'), true);
checkCompatibility('GitHub heading with literal TeX', render('# Formula:$\\alpha + \\beta$').html.includes('id="formulaalpha--beta"'), true);
checkCompatibility('GitHub raw del', render('<del>deleted text</del>').html.includes('<del>deleted text</del>'), true);
checkCompatibility('Default raw del unchanged', render('<del>deleted text</del>', 'default').html.includes('<del>'), false);
const mathCount = (markdown: string, preset: 'default' | 'github-readme' = 'github-readme') =>
  (render(markdown, preset).html.match(/class="meo-export-math /g) ?? []).length;
for (const preset of ['default', 'github-readme'] as const) {
  checkCompatibility(`${preset} all-space code`, render('`   `', preset).html.includes('<code>   </code>'), true);
  checkCompatibility(`${preset} table all-space code`, render('| Value |\n| --- |\n| `   ` |', preset).html.includes('<code>   </code>'), true);
  checkCompatibility(`${preset} table escaped code pipe`, render('| Value |\n| --- |\n| `cat\\|dog` |', preset).html.includes('<code>cat|dog</code>'), true);
  checkCompatibility(`${preset} math ignores comment delimiter`, mathCount('TARGET $x <!-- y$ --> z$ AFTER', preset), 1);
}
for (const [name, markdown, expected] of [
  ['spaced inline', 'ASCII with spaces: $a+b$.', 1],
  ['unspaced inline', 'ASCII without spaces:$a+b$.', 0],
  ['Chinese spaced inline', '中文有空格： $a+b$。', 1],
  ['Chinese unspaced inline', '中文无空格：$a+b$。', 0],
  ['standalone inline', '$a+b$', 1],
  ['heading inline', '# Heading $a+b$', 1],
  ['table inline', '| Formula |\n| --- |\n| $a+b$ |', 1],
  ['table unspaced inline', '| Formula |\n| --- |\n| 公式：$a+b$。 |', 0],
  ['display', '$$\na+b=c\n$$', 1],
  ['display with blank line inside', '$$\na+b=c\n\n$$', 0],
  ['list display', '- List\n\n  $$\n  a+b=c\n  $$', 0],
  ['quote display', '> $$\n> a+b=c\n> $$', 1],
  ['footnote math', 'Reference[^math]\n\n[^math]: Formula $a+b$.\n\n    $$\n    a+b=c\n    $$', 0],
] as const) checkCompatibility(`GitHub ${name}`, mathCount(markdown), expected);
checkCompatibility('Default unspaced inline unchanged', mathCount('中文无空格：$a+b$。', 'default'), 1);
checkCompatibility('Default list display unchanged', mathCount('- List\n\n  $$\n  a+b=c\n  $$', 'default'), 1);
const footnoteDiagram = 'Reference[^diagram]\n\n[^diagram]: Diagram\n\n    ```mermaid\n    graph LR\n      A --> B\n    ```';
checkCompatibility('GitHub footnote Mermaid', render(footnoteDiagram).html.includes('class="meo-export-mermaid"'), false);
checkCompatibility('Default footnote Mermaid unchanged', render(footnoteDiagram, 'default').html.includes('class="meo-export-mermaid"'), true);
assert.deepEqual(compatibilityFailures, []);
const complexFixture = readFileSync('scripts/fixtures/github-readme/complex/README.md', 'utf8');
assert.equal(mathCount(complexFixture), 14);
assert.equal((render(complexFixture).html.match(/class="meo-export-mermaid"/g) ?? []).length, 16);
const alert = render('> [!NOTE]\n> First line\n> Second line').html;
assert.ok(alert.includes('meo-export-alert-note') && alert.includes('Note'));
assert.ok(!alert.includes('[!NOTE]') && !alert.includes('<br'));
assert.ok(!render('> > [!NOTE]\n> > Nested').html.includes('meo-export-alert-note'));
const details = render('<details>\n<summary>More</summary>\n\n**Inside**\n\n</details><!-- hidden HTML comment -->\n\n# Outside').html;
assert.ok(details.includes('<strong>Inside</strong>') && /<\/details>\s*<h1/.test(details), details);
assert.ok(!details.includes('hidden HTML comment'));
const frontmatter = render('---\ntitle: Sample\ntags: [one, two]\n---\n\n# Body').html;
assert.ok(frontmatter.includes('<table') && frontmatter.includes('Sample') && frontmatter.includes('one, two'));
assert.ok(frontmatter.includes('data-source-line="6"'), frontmatter);
assert.ok(render('---\ncycle: &items [*items]\n---\n\n# Body').html.includes('Body'));
assert.deepEqual(resolvePreviewPresetSettings('github-readme', environment), {
  previewFontFamily: '', previewSourceColoring: true, previewShowComments: false
});
assert.deepEqual(resolvePreviewPresetSettings('default', environment), environment);

const request = { type: 'requestPreviewRender', requestId: 'preset-test', text, uiLanguage: 'en', environment };
assert.ok(decodePreviewRenderRequest(request));
assert.ok(decodePreviewRenderRequest({ ...request, preset: 'github-readme', contentWidth: 'reference' }));
assert.equal(decodePreviewRenderRequest({ ...request, preset: 'unknown' }), null);
assert.equal(decodePreviewRenderRequest({ ...request, contentWidth: 'unknown' }), null);
assert.ok(decodePreviewRenderResponse({ type: 'previewRenderResult', requestId: request.requestId, result: { ok: true, value: github } }));
assert.equal(decodePreviewRenderResponse({ type: 'previewRenderResult', requestId: request.requestId, result: { ok: true, value: { ...github, preset: 'unknown' } } }), null);
const state = { preset: 'github-readme', preferences: { default: { appearance: 'light', contentWidth: 'responsive' }, 'github-readme': { appearance: 'dark', contentWidth: 'reference' } } };
assert.deepEqual(decodePreviewPresetState(state), { ...state, preferences: { ...state.preferences, 'github-readme': { appearance: 'dark', contentWidth: 'responsive' } } });
assert.equal(decodePreviewPresetState({ ...state, preset: 'unknown' }), null);
assert.equal(decodePreviewPresetState({ ...state, preferences: { default: { appearance: 'invalid', contentWidth: 'responsive' } } }), null);
const snapshot = { type: 'exportSnapshotResult', requestId: 'export', result: { ok: true, value: { snapshotId: 'export', text, appearance: 'dark', uiLanguage: 'en', environment, preset: 'github-readme' } } };
assert.equal(decodeExportSnapshotResponse(snapshot)?.result.ok, true);
assert.equal(decodeExportSnapshotResponse({ ...snapshot, result: { ...snapshot.result, value: { ...snapshot.result.value, preset: 'unknown' } } }), null);
assert.equal(new Set(previewPresets.map(preset => preset.id)).size, previewPresets.length);
for (const preset of previewPresets) {
  for (const language of ['en', 'zh-CN'] as const) assert.ok(preset.name[language] && preset.description[language]);
  for (const key of ['codeColoring', 'htmlComments'] as const) {
    if (preset.controls[key].mode === 'fixed') assert.equal(typeof preset.controls[key].value, 'boolean');
  }
  for (const path of Object.values(preset.styles ?? {})) {
    assert.ok(readFileSync(`src/preview/presets/${preset.id}/${path}`, 'utf8').includes('.markdown-body'));
  }
}
assert.ok(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8').includes(readFileSync('src/preview/presets/github-readme/license', 'utf8').trim()));
console.log('Preview preset rendering, capabilities and protocol tests passed.');
