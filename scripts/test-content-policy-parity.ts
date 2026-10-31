import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import { buildPreviewStyles } from '../src/export/exportStyles';
import { createMarkdownContentParser } from '../src/shared/markdownContentParser';
import { renderHtmlMarkdown } from '../src/shared/htmlMarkdown';

const fixtures: Array<{ text: string; quotes: number[]; heading?: boolean; table?: boolean }> = [
  { text: '> quote\n2. next', quotes: [1] },
  { text: '>> quote\n10) next', quotes: [1] },
  { text: '1. **引用**  \n  >使用">"来进行嵌套\n  >>当然使用">>"也能够叠加嵌套\n2. **列表**\n  i. 无序列表  \n    + 列表 **+**\n    - 列表 **-**', quotes: [2, 3] },
  { text: '> quote\nlazy continuation', quotes: [1, 2] },
  { text: '> quote\n> 2. literal continuation', quotes: [1, 2] },
  { text: '- parent\n  > quote\n2. next', quotes: [2] },
  { text: '> - parent\n> 2. next', quotes: [1, 2] },
  { text: '> quote\n\n2. next', quotes: [1] },
  { text: 'a | b\n---\nx | y', quotes: [], heading: true },
  { text: '> a | b\n> ---\n> x | y', quotes: [1, 2, 3], heading: true },
  { text: '1. a | b\n   --- | ---\n   x | y', quotes: [], table: true },
  { text: '> 1. a | b\n>    --- | ---\n>    x | y', quotes: [], table: true }
];
const formatting = [
  '# Markdown heading', '', '<h1 id="html-heading">HTML heading</h1>', '',
  '**MarkdownStrong** *MarkdownEm* ~~MarkdownStrike~~ H~2~O x^2^ ==MarkdownMark==', '',
  '`MarkdownCode` and <code id="html-code">HTML code</code>', '',
  '<p><b id="html-strong">HTML strong</b> <i id="html-em">HTML emphasis</i> <s id="html-strike">HTML strike</s> <sub id="html-sub">sub</sub> <sup id="html-sup">sup</sup> <mark id="html-mark">mark</mark></p>', '',
  '<p><b id="author-style" style="font-size:21px;font-weight:300;color:rgb(123,45,67)">Author style</b></p>', '',
  '<p><span style="color:rgb(123,45,67)"><strong id="author-inherited">Inherited author color</strong></span></p>', '',
  '<p><code>**literal** $x$</code></p>'
].join('\n');

// HTML fragments and reading prose consume the same grammar, including literal code.
for (const [source, expected] of [['`   `', '<code>   </code>'], ['``  ``', '<code>  </code>'],
  ['<code>**literal** $x$</code>', '<code>**literal** $x$</code>']]) {
  assert.equal(renderHtmlMarkdown(source, true), expected);
  assert.equal(createMarkdownContentParser().renderInline(source), expected);
}
const literalHtmlCode = renderMarkdownToHtml({ markdownText: 'Before <code>first<br>- literal</code> after',
  markdownFilePath: 'D:/fixture/content.md', target: 'html' }).html;
assert.ok(!literalHtmlCode.includes('<ul'), 'body break scanning must keep HTML code literal');
const build = await Bun.build({ entrypoints: [path.resolve('scripts/test-list-editing-entry.ts')], target: 'browser', format: 'iife' });
if (!build.success) throw Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 850 });
  await page.setContent('<style>body{margin:0}main{display:grid;grid-template-columns:1fr 1fr;height:100vh}#live{min-width:0}#live .cm-editor{height:100%}iframe{box-sizing:border-box;width:100%;height:100%;border:0}</style><main><div id="live"></div><iframe id="preview"></iframe></main>');
  await page.addStyleTag({ path: path.resolve('webview/src/styles.css') });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  for (const large of [false, true]) {
    for (const appearance of ['light', 'dark'] as const) {
      for (const fixture of fixtures) {
        const finite = fixture.text + '\n\nAFTER';
        const source = finite + (large ? '\n\n' + 'padding text\n'.repeat(8100) : '');
        const result = await page.evaluate(async ({ source, finite, appearance }) => {
          document.documentElement.dataset.editorAppearance = appearance;
          const harness = (window as any).ListEditingHarness;
          harness.applyBuiltInVisualBaseline(appearance);
          const host = document.querySelector('#live')!; host.replaceChildren();
          const editor = harness.createEditor({ parent: host, text: source, initialMode: 'live', onApplyChanges() {} });
          editor.view.dispatch({ selection: { anchor: finite.length } });
          for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const quoteLines = () => [...host.querySelectorAll<HTMLElement>('.cm-line.meo-md-quote')]
            .map(line => editor.view.state.doc.lineAt(editor.view.posAtDOM(line)).number);
          const before = quoteLines();
          const heading = host.querySelector('.meo-md-h2')?.textContent;
          const table = host.querySelector('.meo-md-html-table:not(.meo-md-html-table-sticky-table)');
          const tableCells = table ? [...table.querySelectorAll('th,td')].map(cell =>
            (cell.querySelector('.meo-md-html-table-cell-preview') ?? cell).textContent?.replace(/\s+/g, '')) : null;
          editor.setMode('source'); editor.setMode('live');
          for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const result = { before, after: quoteLines(), heading, tableCells, unchanged: editor.getText() === source,
            optimized: harness.usesLargeDocumentDerivedWorkBudget(editor.view.state) };
          editor.destroy(); return result;
        }, { source, finite, appearance });
        const label = `${appearance}/${large ? 'optimized' : 'ordinary'}/${fixture.text}`;
        assert.deepEqual(result.before, fixture.quotes, label);
        assert.deepEqual(result.after, fixture.quotes, label + '/mode roundtrip');
        assert.equal(result.unchanged, true, label);
        assert.equal(result.optimized, large, label);
        const html = renderMarkdownToHtml({ markdownText: finite, markdownFilePath: 'D:/fixture/content.md', target: 'html' }).html;
        if (fixture.table) {
          const cells = await page.evaluate(html => {
            const root = document.createElement('div'); root.innerHTML = html;
            return [...root.querySelectorAll('th,td')].map(cell => cell.textContent?.replace(/\s+/g, ''));
          }, html);
          assert.deepEqual(result.tableCells, cells, label + '/table content');
          assert.ok(result.tableCells?.includes('x') && result.tableCells?.includes('y'), label + '/table rendered');
        }
        if (fixture.heading) {
          assert.ok(result.heading?.includes('a | b'), label);
          assert.ok(html.includes('<h2'), label + '/Preview heading');
          assert.ok(!html.includes('<table'), label + '/Preview must not repair a thematic underline');
        }
      }
      const source = formatting + '\n\nAFTER' + (large ? '\n\n' + 'padding text\n'.repeat(8100) : '');
      const html = renderMarkdownToHtml({ markdownText: formatting, markdownFilePath: 'D:/fixture/content.md', target: 'html' }).html;
      const css = buildPreviewStyles({ previewFontFamily: '' }, appearance);
      const result = await page.evaluate(async ({ source, html, css, caret }) => {
        const host = document.querySelector('#live')!; host.replaceChildren();
        const editor = (window as any).ListEditingHarness.createEditor({ parent: host, text: source, initialMode: 'live', onApplyChanges() {} });
        editor.view.dispatch({ selection: { anchor: caret } });
        for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const iframe = document.querySelector<HTMLIFrameElement>('#preview')!;
        const doc = iframe.contentDocument!;
        doc.open(); doc.write('<!doctype html><style>' + css + '</style><article class="meo-export-doc">' + html + '</article>'); doc.close();
        const style = (element: Element, property: string) => element.ownerDocument.defaultView!.getComputedStyle(element).getPropertyValue(property);
        const pairs = [
          ['.meo-md-strong', '#html-strong', 'font-weight'], ['.meo-md-em', '#html-em', 'font-style'],
          ['.meo-md-strike', '#html-strike', 'text-decoration-line'], ['.meo-md-subscript', '#html-sub', 'font-size'],
          ['.meo-md-superscript', '#html-sup', 'font-size'], ['.meo-md-highlight', '#html-mark', 'background-color'],
          ['.meo-md-h1', '#html-heading', 'font-size'], ['.meo-md-h1', '#html-heading', 'font-weight'],
          ['.meo-md-h1', '#html-heading', 'color'], ['.meo-md-inline-code', '#html-code', 'font-size'],
          ['.meo-md-inline-code', '#html-code', 'padding-left'], ['.meo-md-inline-code', '#html-code', 'border-radius']
        ].map(([markdown, raw, property]) => ({ markdown, property,
          ordinary: style(host.querySelector(markdown)!, property), html: style(host.querySelector(raw)!, property) }));
        const author = host.querySelector('#author-style')!;
        const previewAuthor = doc.querySelector('#author-style')!;
        const result = { pairs, author: [style(author, 'font-size'), style(author, 'font-weight'), style(author, 'color')],
          previewAuthor: [style(previewAuthor, 'font-size'), style(previewAuthor, 'font-weight'), style(previewAuthor, 'color')],
          inherited: style(host.querySelector('#author-inherited')!, 'color'),
          previewInherited: style(doc.querySelector('#author-inherited')!, 'color'),
          plainColor: style(editor.view.contentDOM, 'color'), strongColor: style(host.querySelector('.meo-md-strong')!, 'color'),
          previewStrong: style(doc.querySelector('#html-strong')!, 'font-weight'),
          previewSub: style(doc.querySelector('#html-sub')!, 'font-size'), unchanged: editor.getText() === source };
        if (!(window as any).__contentPolicyEditor) (window as any).__contentPolicyEditor = editor;
        else { (window as any).__contentPolicyEditor.destroy(); (window as any).__contentPolicyEditor = editor; }
        return result;
      }, { source, html, css, caret: formatting.length + 7 });
      for (const pair of result.pairs) assert.equal(pair.html, pair.ordinary, `${appearance}/${large}/${pair.markdown}/${pair.property}`);
      assert.deepEqual(result.author, ['21px', '300', 'rgb(123, 45, 67)']);
      assert.deepEqual(result.previewAuthor, result.author);
      assert.equal(result.inherited, 'rgb(123, 45, 67)');
      assert.equal(result.previewInherited, result.inherited);
      if (appearance === 'dark') assert.notEqual(result.strongColor, result.plainColor, 'theme defaults retain the existing dark strong emphasis');
      assert.equal(result.previewStrong, '700'); assert.equal(result.unchanged, true);
      if (process.env.MEO_TEST_SCREENSHOTS && !large) {
        fs.mkdirSync(process.env.MEO_TEST_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.MEO_TEST_SCREENSHOTS, `content-policy-${appearance}.png`) });
      }
      await page.evaluate(() => { (window as any).__contentPolicyEditor.destroy(); delete (window as any).__contentPolicyEditor; });
      const inputSource = '> quote\n2. next\n\nAFTER' + (large ? '\n\n' + 'padding text\n'.repeat(8100) : '');
      await page.evaluate(source => {
        const host = document.querySelector('#live')!; host.replaceChildren();
        const editor = (window as any).ListEditingHarness.createEditor({ parent: host, text: source, initialMode: 'live', onApplyChanges() {} });
        (window as any).__contentInputEditor = editor;
        editor.view.dispatch({ selection: { anchor: source.indexOf('2. next') } }); editor.view.focus();
      }, inputSource);
      await page.keyboard.type('> ');
      await page.waitForFunction(() => (window as any).__contentInputEditor.getText().startsWith('> quote\n> 2. next'));
      const inputQuotes = () => page.evaluate(() => {
        const editor = (window as any).__contentInputEditor;
        return [...editor.view.contentDOM.querySelectorAll('.cm-line.meo-md-quote')]
          .map(line => editor.view.state.doc.lineAt(editor.view.posAtDOM(line)).number);
      });
      await page.waitForFunction(() => (window as any).__contentInputEditor.view.contentDOM.querySelectorAll('.cm-line.meo-md-quote').length === 2);
      assert.deepEqual(await inputQuotes(), [1, 2]);
      await page.evaluate(async () => { await (window as any).__contentInputEditor.undo(); });
      await page.waitForFunction(expected => (window as any).__contentInputEditor.getText() === expected, {}, inputSource);
      await page.waitForFunction(() => (window as any).__contentInputEditor.view.contentDOM.querySelectorAll('.cm-line.meo-md-quote').length === 1);
      assert.deepEqual(await inputQuotes(), [1]);
      await page.evaluate(() => { (window as any).__contentInputEditor.destroy(); delete (window as any).__contentInputEditor; });
    }
  }
} finally { await closeTestBrowser(browser); }
console.log('PASS shared content policy: quote/list boundaries, lazy continuation, Setext/table precedence, Markdown/HTML typography, author styles, light/dark, ordinary/optimized and mode roundtrips');
