import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createDocumentStatisticsIndex as createIndex } from '../webview/src/adapters/documentStatisticsIndex';
import { createDocumentStatisticsReporter } from '../webview/src/adapters/documentStatistics';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { MarkdownParser } from '@lezer/markdown';
import { inlineMarkdownExtensions } from '../webview/src/helpers/inlineMarkdownParser';
import { decodeWebviewToHostMessage } from '../src/protocol/messages';
import { statisticsCases } from './document-statistics-cases';

const grammar = (markdownLanguage.parser as MarkdownParser).configure(inlineMarkdownExtensions);
const createDocumentStatisticsIndex = (text: string) => createIndex(text, grammar);
const stats = (text: string) => createDocumentStatisticsIndex(text)([], 1);
for (const c of statisticsCases) assert.equal(stats(c.source).words, c.words, c.name);
assert.equal(stats('[链接][id]\n\n[id]: https://example.test').words, 2, 'reference label and definition are hidden');
let combinations = 0;
for (const left of statisticsCases) for (const right of statisticsCases) {
  const source = `| A | B |\n| --- | --- |\n| ${left.source} | ${right.source} |`;
  const body = source.indexOf('\n', source.indexOf('\n') + 1) + 1;
  const index = createDocumentStatisticsIndex(source);
  assert.equal(index([], 1).words, 2 + left.words + right.words, `${left.name} + ${right.name}: total`);
  assert.equal(index([{ from: body, to: source.length }], 3).selectedWords, left.words + right.words, `${left.name} + ${right.name}: selected`);
  combinations++;
}
const formatted = createDocumentStatisticsIndex('he**ll**o');
assert.equal(formatted([{from:2,to:4}],1).selectedWords,0,'formatting alone is not a word');
assert.equal(formatted([{from:0,to:2},{from:4,to:6},{from:8,to:9}],1).selectedWords,1,'one word across formatting, multiple selections');
const entityWord = createDocumentStatisticsIndex('caf&#233;');
assert.equal(entityWord([{from:3,to:9}],1).selectedWords,1,'entity source maps to its visible word');
const wiki = '[[target\\|别名]]';
assert.equal(createDocumentStatisticsIndex(wiki)([{from:2,to:8}],1).selectedWords,0,'hidden wiki target is excluded');
assert.equal(createDocumentStatisticsIndex('')([{from:0,to:0}],1,true).hasSelection,true,'empty rectangular cells remain a selection');
assert.equal(stats('').words, 0);
assert.equal(stats('Hello世界 café don’t 123 😀').words, 6);
assert.equal(stats('# **你好** [world](https://example.test "hidden title")').words, 3);
assert.equal(stats('---\ntitle: hidden\n---\n正文').words, 2);
assert.equal(stats('```typescript\nconst value = 1\n```').words, 3);
assert.equal(stats('| A | B |\n| --- | --- |\n| 中文 | world |').words, 5);
assert.equal(stats('<div class="hidden">Hello 世界</div>\n<!-- hidden -->').words, 3);
assert.equal(stats('a\r\nb\nc\r').lines, 4);
assert.equal(stats('𠀀😀').characters, 2);
const text = '**Hello** [world](https://example.test) 中文';
const index = createDocumentStatisticsIndex(text);
assert.equal(index([{ from: 3, to: 5 }, { from: 4, to: 6 }], 1).selectedWords, 1, 'overlapping selections count a word once');
assert.equal(index([{ from: text.indexOf('https'), to: text.indexOf(')') }], 1).selectedWords, 0, 'selected link destination stays excluded');
assert.equal(index([{ from: 0, to: text.length }], 1).selectedWords, 4);
assert.equal(index([], null).line, null);
assert.equal(decodeWebviewToHostMessage({ type: 'documentStatistics', statistics: stats(text) })?.type, 'documentStatistics');
assert.equal(decodeWebviewToHostMessage({ type: 'documentStatistics', statistics: { ...stats(text), line: 999 } }), null);
assert.equal(decodeWebviewToHostMessage({ type: 'documentStatistics', statistics: { ...stats(text), selectedWords: Infinity } }), null);

const items: any[] = [];
mock.module('vscode', () => ({ StatusBarAlignment: { Right: 2 }, workspace: { onDidChangeConfiguration() { return { dispose() {} }; } }, window: { createStatusBarItem() {
  const item = { visible: false, disposed: false, text: '', tooltip: '', show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.disposed = true; this.visible = false; } };
  items.push(item); return item;
} } }));
const { createVscodeDocumentStatistics } = await import('../src/host/vscodeDocumentStatistics');
const panel = () => ({ active: true, listener: () => {}, onDidChangeViewState(listener: () => void) { this.listener = listener; return { dispose() {} }; } });
const a = panel(), b = panel(); b.active = false;
const first = createVscodeDocumentStatistics(a as never, () => 'zh-CN');
const second = createVscodeDocumentStatistics(b as never, () => 'en');
first.update(index([], 1)); second.update(stats('Another document'));
assert.equal(items[0].visible, true); assert.equal(items[1].visible, false);
assert.match(items[0].text, /行 1\/1 · 字数 4/);
a.active = false; b.active = true; a.listener(); b.listener();
assert.equal(items[0].visible, false); assert.equal(items[1].visible, true);
assert.match(items[1].text, /Words 2/);
second.update(index([], null)); assert.match(items[1].text, /^1 lines/);
second.update(null); assert.equal(items[1].visible, false);
first.dispose(); second.dispose(); assert.ok(items.every(i => i.disposed));
const large = createDocumentStatisticsIndex('Hello 世界\n'.repeat(20_000));
assert.equal(large([], 1).words, 60_000);
assert.equal(large([{ from: 0, to: 5 }], 1).selectedWords, 1);
const reporter = createDocumentStatisticsReporter(() => null, () => { throw new Error('Disposed statistics must not publish'); });
reporter.dispose();
const originalSetTimeout = globalThis.setTimeout;
let scheduledAfterDispose = 0;
try {
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    scheduledAfterDispose++;
    return Reflect.apply(originalSetTimeout, globalThis, args);
  }) as typeof setTimeout;
  reporter.schedule();
  assert.equal(scheduledAfterDispose, 0, 'Presentation teardown must not requeue a disposed statistics reporter');
} finally { globalThis.setTimeout = originalSetTimeout; reporter.dispose(); }
console.log(`Document statistics: ${statisticsCases.length} cases, ${combinations} paired combinations, source selections, protocol, lifecycle and large document passed`);
