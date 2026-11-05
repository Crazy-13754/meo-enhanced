import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { MarkdownParser } from '@lezer/markdown';
import { scanLatexMath, mathDelimiterLength } from '../src/shared/latexMathScanner';
import { mathFenceBodyRange } from '../src/shared/mathFence';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import exportRuntime, { preparePreviewDocument } from '../src/export/runtime';
import { getInlineMarkdownExtensions } from '../webview/src/helpers/inlineMarkdownParser';
import { collectDocumentMathRanges, getMathCompletionBody } from '../webview/src/helpers/displayMathBlocks';
import { latexDelimitersFacet } from '../webview/src/editor/mathSyntaxPreference';
import { prepareMarkdownDocumentContext } from '../webview/src/markdownDocumentContext';
import { decodePreviewRenderRequest } from '../src/protocol/previewRender';
import { decodeExportSnapshotResponse } from '../src/protocol/exportSnapshot';
import darkPlus from '@shikijs/themes/dark-plus';
import { activateShikiCodeHighlighting, setShikiTheme, requestShikiTokens, getShikiTokens } from '../webview/src/helpers/shikiHighlighter';
import { latexMarkdownSyntaxLanguage } from '../webview/src/adapters/markdownSyntaxGrammar';
import { getPreviewPreset, previewPresets } from '../src/foundation/previewPresets';

const enabled = { latexDelimiters: true };
const render = (text: string, latexDelimiters = false, contentOnly = false) => renderMarkdownToHtml({
  markdownText: text, markdownFilePath: '', target: 'html', latexDelimiters, contentOnly
});
const samples = [String.raw`\( a+b \)`, String.raw`\[a+b\]`, '\\[\na+b\n\\]',
  '> \\[\n> a+b\n> \\]', '- \\[\n  a+b\n  \\]'];
for (const text of samples) {
  assert.equal(scanLatexMath(text).length, 0, 'default preserves bracket escapes');
  const [range] = scanLatexMath(text, enabled);
  assert.equal(range?.content, 'a+b', text);
  assert.equal(range.raw, text.slice(range.from, range.to));
  assert.equal(mathDelimiterLength(range), 2);
  assert.equal(render(text).hasMath, false);
  assert.equal(render(text, true).hasMath, true, text);
  assert.match(render(text, true, true).html, /<math\b/, 'Word/content-only uses the same MathML formula');
}
for (const text of [...samples, samples[0] + ' and $x^2$', '```math\n\\(a+b\\)\n```']) {
  for (const preset of previewPresets) {
    const options = { markdownText: text, sourceDocumentPath: '', uiLanguage: 'en' as const, preset: preset.id };
    const off = exportRuntime.renderPreviewDocument({ ...options, latexDelimiters: false });
    const on = exportRuntime.renderPreviewDocument({ ...options, latexDelimiters: true });
    if (preset.renderer === 'github-readme') {
      assert.equal(on.html, off.html, 'GitHub README syntax must ignore the LaTeX switch: ' + text);
      assert.equal(on.html.includes('class="meo-export-math'), text.includes('$') || text.startsWith('```math'), 'GitHub retains its dollar and fenced math syntax');
    } else {
      assert.notEqual(on.html, off.html, preset.id + ' follows the LaTeX switch');
      assert.ok(on.html.includes('class="meo-export-math'));
    }
  }
}
const githubBase = getPreviewPreset('github-readme');
const githubCopy = { ...githubBase, id: 'user:github-copy' as const };
const customGithubOptions = { markdownText: samples[0], sourceDocumentPath: '', uiLanguage: 'en' as const, preset: githubCopy.id, presetDefinition: githubCopy };
assert.equal(exportRuntime.renderPreviewDocument({ ...customGithubOptions, latexDelimiters: true }).html,
  exportRuntime.renderPreviewDocument({ ...customGithubOptions, latexDelimiters: false }).html,
  'Presets using the GitHub renderer share its fixed syntax');
assert.match(render(String.raw`note \(optional\)`).html, /note \(optional\)/);
assert.match(render(String.raw`\[draft\]`).html, /\[draft\]/);
for (const text of [String.raw`\(hello world\)`, String.raw`\( 12 \)`, String.raw`\(\text{a \) b} + c\)`]) {
  assert.equal(scanLatexMath(text, enabled).length, 1, 'explicit math does not guess whether content resembles prose');
}
for (const text of [String.raw`\\(x\\)`, String.raw`\\[x\\]`, String.raw`\(x\]`, String.raw`\[x\)`,
  '\\(a\nb\\)', '\\[\nx\n# Next\n\\]', String.raw`\(\)`, String.raw`\[\]`]) {
  assert.deepEqual(scanLatexMath(text, enabled), [], text);
  assert.equal(render(text, true).hasMath, false, text);
}
for (const text of ['cost $2.50 and $2.00', '(optional) [draft]', '$a+b$', '$$\na+b\n$$']) {
  assert.deepEqual(scanLatexMath(text, enabled), scanLatexMath(text), 'dollar syntax/prose unchanged');
}
for (const text of ['`\\(x\\)`', '```js\n\\[x\\]\n```', '<code>\\(x\\)</code>',
  '[link](https://example.test/\\(x\\))', '<!-- \\(x\\) -->']) {
  assert.equal(render(text, true).hasMath, false, 'protected Markdown context: ' + text);
}
const body = mathFenceBodyRange(String.raw`  \( a+b \)  `, true);
assert.equal(String.raw`  \( a+b \)  `.slice(body.from, body.to), ' a+b ');
const parser = (enabled: boolean) => (markdownLanguage.parser as MarkdownParser).configure(getInlineMarkdownExtensions(enabled));
for (const latexDelimiters of [false, true]) {
  const grammar = parser(latexDelimiters);
  for (const text of samples) {
    const tree = grammar.parse(text);
    const state = EditorState.create({ doc: text, extensions: latexDelimitersFacet.of(latexDelimiters) });
    const context = prepareMarkdownDocumentContext(state.doc, tree, 4, undefined, latexDelimiters).blocks();
    assert.equal(context.math.length, Number(latexDelimiters), 'background and main thread agree: ' + text);
  }
  for (const text of ['`\\(x\\)`', '```text\n\\[x\\]\n```', '[link](https://example.test/\\(x\\))']) {
    const state = EditorState.create({ doc: text, extensions: latexDelimitersFacet.of(latexDelimiters) });
    assert.equal(collectDocumentMathRanges(state, grammar.parse(text)).length, 0);
  }
}
for (const marked of ['\\( \\al| \\)', '\\( \\al|', '\\[\n\\al|\n\\]', '\\[\n\\al|', '\\(12 meters \\al|']) {
  const position = marked.indexOf('|'), text = marked.replace('|', '');
  const state = EditorState.create({ doc: text, extensions: [latexDelimitersFacet.of(true)] });
  const context = getMathCompletionBody(state, position);
  assert.ok(context, 'complete and unfinished math supports completion: ' + marked);
  assert.equal(text.slice(context.from, position).trim(), marked.includes('12 meters') ? '12 meters \\al' : '\\al');
}
const many = samples.slice(2, 3).map(text => text + '\n\n').join('').repeat(256);
const prepared = preparePreviewDocument({ markdownText: many, latexDelimiters: true, sourceDocumentPath: '', uiLanguage: 'en' }, true);
assert.ok(prepared.renderAll().html.includes('data-meo-deferred-math'), 'large/windowed Preview retains the syntax preference');
const githubWindowed = (latexDelimiters: boolean) => preparePreviewDocument({
  markdownText: many, latexDelimiters, sourceDocumentPath: '', uiLanguage: 'en', preset: 'github-readme'
}, true);
assert.equal(githubWindowed(true).renderAll().html, githubWindowed(false).renderAll().html, 'Windowed GitHub Preview also ignores the switch');
const request = { type: 'requestPreviewRender', requestId: 'math', text: samples[0], uiLanguage: 'en', environment: { previewFontFamily: '' }, latexDelimiters: true };
assert.equal(decodePreviewRenderRequest(request)?.latexDelimiters, true);
assert.equal(decodePreviewRenderRequest({ ...request, latexDelimiters: 'true' }), null);
const snapshot = { type: 'exportSnapshotResult', requestId: 'math', result: { ok: true, value: {
  snapshotId: 'math', text: samples[0], uiLanguage: 'en', appearance: 'light', environment: { previewFontFamily: '' }, latexDelimiters: true
} } };
assert.equal(decodeExportSnapshotResponse(snapshot)?.result.ok, true);
assert.equal(decodeExportSnapshotResponse({ ...snapshot, result: { ok: true, value: { ...snapshot.result.value, latexDelimiters: 'true' } } }), null);
for (const target of ['html', 'pdf', 'docx'] as const) for (const latexDelimiters of [false, true]) {
  const exported = await exportRuntime.renderExportHtmlDocument({
    readingSnapshot: { snapshotId: 'math', text: samples[0]!, uiLanguage: 'en', appearance: 'light', latexDelimiters,
      environment: { previewFontFamily: '', previewSourceColoring: false } },
    sourceDocumentPath: '', outputFilePath: '', target, title: 'Math', mermaidRuntimeSrc: '', baseHref: '', shikiLanguageAssetsRoot: ''
  });
  assert.equal(exported.hasMath, latexDelimiters, target + ' uses the frozen export syntax choice');
}
for (const target of ['html', 'pdf'] as const) {
  const renderGithubExport = (latexDelimiters: boolean) => exportRuntime.renderExportHtmlDocument({
    readingSnapshot: { snapshotId: 'github-math', text: samples[0] + '\n\n' + samples[2],
      uiLanguage: 'en', appearance: 'light', preset: 'github-readme', latexDelimiters,
      environment: { previewFontFamily: '', previewSourceColoring: false } },
    sourceDocumentPath: '', outputFilePath: '', target, title: 'Math', mermaidRuntimeSrc: '', baseHref: '', shikiLanguageAssetsRoot: ''
  });
  const off = await renderGithubExport(false), on = await renderGithubExport(true);
  assert.equal(on.hasMath, false, target + ' export retains fixed GitHub syntax');
  assert.equal(on.htmlDocument, off.htmlDocument, target + ' export ignores the LaTeX switch');
}
setShikiTheme(darkPlus, 'source');
const release = activateShikiCodeHighlighting('source');
try {
  const text = '\\( \\frac{a}{b} \\)\n\n\\[\n\\sqrt{x}\n\n\\]\n\n# Heading';
  for (const language of ['markdown', latexMarkdownSyntaxLanguage, 'markdown']) {
    requestShikiTokens(language, text, 'source');
    let tokens = getShikiTokens(language, text, 'source');
    for (let attempt = 0; !tokens && attempt < 3000; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1));
      tokens = getShikiTokens(language, text, 'source');
    }
    assert.ok(tokens, 'syntax tokens are published');
    assert.equal(tokens.map(line => line.map(fragment => fragment.content).join('')).join('\n'), text);
    assert.equal(tokens.flat().some(fragment => fragment.scopeNames?.includes('entity.name.function.math.tex')), language === latexMarkdownSyntaxLanguage,
      'opt-in grammar colors formulas without affecting disabled documents');
    assert.ok(tokens.at(-1)!.some(fragment => fragment.scopeNames?.some(scope => scope.startsWith('markup.heading'))), 'Markdown recovers after the closer');
  }
} finally { release(); }
console.log('Opt-in LaTeX delimiters: literal defaults, shared parsing, completion, containers, protection, Preview and MathML passed');
