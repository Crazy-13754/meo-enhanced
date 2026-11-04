import assert from 'node:assert/strict';
import { renderDocumentContent } from '../src/export/documentContent';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import { parseDocument, DomUtils } from 'htmlparser2';
import { decodeWebviewToHostMessage, decodeHostToWebviewMessage } from '../src/protocol/messages';
import { createDocumentContentTransport } from '../webview/src/adapters/documentContentTransport';

const text = ['# Root <!-- nodeColor: red -->', '', '- Parent', '', '  | Cell | Code |', '  | --- | ---: |',
  '  | > Outer<br>> > Inner<br>> > - Nested | `x` and $x^2$ |', '', '  > Quote under list', '  > - Quoted list', '',
  '  - Child', '', '## Next', 'Tail', '', '- [x] Done', '- `<!-- fold: tree -->`', '',
  '```ts', 'const x = 1;', '```', '', '![Alt](file:///never-read.png)', '<img src="https://example.invalid/no-read" alt="Raw alt" onerror="alert(1)">',
  '<style>body{display:none}</style>', '<script>alert(1)</script>'].join('\n');
const { html } = renderDocumentContent(text);
const dom = parseDocument(html);
const elements = (name: string) => DomUtils.getElementsByTagName(name, dom.children);
assert.equal(elements('table').length, 1);
assert(DomUtils.getText(elements('td')[0]!).includes('Inner'));
assert.equal(DomUtils.getElementsByTagName('blockquote', elements('td')[0]!.children).length, 2);
assert.equal(DomUtils.getElementsByTagName('ul', elements('td')[0]!.children).length, 1);
assert.equal(elements('td')[1]!.attribs.align, 'right');
assert(elements('math').length > 0);
assert(html.includes('☑') && html.includes('Quote under list') && html.includes('Tail'));
assert.equal(elements('table')[0]!.attribs['data-source-line'], '5');
assert.equal(elements('pre')[0]!.attribs['data-source-line'], '20');
assert.equal(elements('img').length, 0);
assert.equal(elements('script').length + elements('style').length + elements('a').length, 0);
assert(!/\s(?:src|href|style|onerror)=/.test(html));
assert(html.includes('Alt') && html.includes('Raw alt'));
// The same table-cell structure comes from the ordinary reading renderer.
const reading = parseDocument(renderMarkdownToHtml({ markdownText: text, markdownFilePath: '', target: 'html', deferImages: true, deferLocalLinks: true }).html);
assert.equal(DomUtils.getText(elements('td')[0]!), DomUtils.getText(DomUtils.getElementsByTagName('td', reading.children)[0]!));
assert(decodeWebviewToHostMessage({ type: 'requestDocumentContent', requestId: '1', text }));
assert.equal(decodeWebviewToHostMessage({ type: 'requestDocumentContent', requestId: '1', text: 3 }), null);
assert.equal(decodeHostToWebviewMessage({ type: 'documentContentResult', requestId: '1', result: { ok: true, value: { html: 3 } } }), null);
let request: any;
const transport = createDocumentContentTransport(value => { request = value; });
const pending = transport.render(text);
transport.accept({ type: 'documentContentResult', requestId: request.requestId, result: { ok: true, value: { html } } });
assert.equal((await pending).html, html);
const canceled = transport.render(text); const rejection = assert.rejects(canceled, /closed/); transport.cancel(); await rejection;
transport.accept({ type: 'documentContentResult', requestId: request.requestId, result: { ok: true, value: { html } } });
console.log('PASS shared read-only content: nested tables/quotes/lists, math, source maps, inert resources, protocol and cancellation.');
