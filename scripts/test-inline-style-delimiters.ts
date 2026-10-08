import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { inlineStyleDelimiter } from '../src/shared/punctuationInlineStyles';
import { editorMarkdownLanguage } from '../webview/src/liveMode';
import { extractHeadings } from '../webview/src/helpers/markdownSyntax';

for (const marker of ['*', '**', '***', '~~', '==']) {
  const text = `前${marker}TARGET：${marker}后续`;
  const opening = inlineStyleDelimiter(text, 1)!;
  const closing = inlineStyleDelimiter(text, text.lastIndexOf(marker))!;
  assert.equal(opening.length, marker.length);
  assert.equal(opening.canOpen, true);
  assert.equal(closing.canClose, true);
  assert.equal(inlineStyleDelimiter(`${marker} text`, 0)?.canOpen, false);
  assert.equal(inlineStyleDelimiter(`text ${marker}`, 5)?.canClose, false);
}
for (const text of ['===TARGET===', '====TARGET====']) {
  for (let index = 0; index < text.length; index += 1) assert.equal(inlineStyleDelimiter(text, index), null);
}

// Native asterisk resolution must keep split runs and ambiguous/unmatched syntax.
for (const source of ['***foo** bar*', '*foo **bar***', '**foo *bar***', '**foo *bar* baz**',
  '*foo **bar** baz*', 'a***b***c', 'foo**bar*baz', '**foo*', '*foo**', '***foo* bar**',
  '*foo**bar**baz*', 'foo***bar***baz', '\\**foo*', '*foo\\**']) {
  assert.equal(editorMarkdownLanguage.language.parser.parse(source).toString(), markdownLanguage.parser.parse(source).toString(), source);
}

const source = '# **outer *TARGET：*AFTER** OUTSIDE';
let state = EditorState.create({ doc: source, extensions: [editorMarkdownLanguage] });
const original = extractHeadings(state);
assert.equal(original[0]!.text, 'outer TARGET：AFTER OUTSIDE');
const close = source.indexOf('*AFTER');
const open = source.indexOf('*TARGET');
state = state.update({ changes: [{ from: open, to: open + 1, insert: '' }, { from: close, to: close + 1, insert: '' }] }).state;
assert.equal(extractHeadings(state)[0]!.inlineSegments!.find(segment => segment.text.includes('TARGET'))!.emphasis, false);
state = state.update({ changes: [{ from: open, insert: '*' }, { from: close - 1, insert: '*' }] }).state;
assert.deepEqual(extractHeadings(state), original, 'incremental parsing restores nesting');

// Sparse long paragraphs retain document-relative marker positions and code text.
const prefix = 'plain text 中文 '.repeat(8_000);
const longSource = `# ${prefix}\\**escaped** x 12**\`TARGET**\`**`;
const heading = extractHeadings(EditorState.create({ doc: longSource, extensions: [editorMarkdownLanguage] }))[0]!;
assert.ok(heading.text.endsWith('12TARGET**'));
assert.equal(heading.inlineSegments!.find(segment => segment.text.includes('TARGET'))!.strong, true);
console.log('Inline style delimiter checks passed (native nesting, incremental parsing, sparse long paragraph).');
