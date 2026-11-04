import assert from 'node:assert/strict';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import { materializeContributedBlocks } from '../src/export/contributedBlocks';
import { decodeBlockExportRequest, decodeBlockExportResponse } from '../src/protocol/blockExport';
import { createBlockExportTransport } from '../src/host/blockExportTransport';
import type { ReadingSnapshot } from '../src/protocol/exportSnapshot';
import { decodeExportSnapshotResponse } from '../src/protocol/exportSnapshot';
import { createExportWebviewAdapter } from '../webview/src/adapters/exportWebviewAdapter';

const renderer = { id: 'test/third', label: 'Third', entryUri: 'https://fixture.test/third.js', codeBlockLanguages: ['third'] };
const snapshot: ReadingSnapshot = { snapshotId: 'test', text: '', appearance: 'light', uiLanguage: 'en', environment: { previewFontFamily: '' }, blockRenderers: [renderer] };
const markdown = '# Before\n\n> ```third\n> same\n> ```\n\n- List\n\n  ```third\n  same\n  ```\n\n```third\nbroken\n```\n\nAfter';
const html = renderMarkdownToHtml({ markdownText: markdown, markdownFilePath: 'fixture.md', target: 'html', exportBlockLanguages: ['third'] }).html;
const result = await materializeContributedBlocks(html, snapshot, 'html', async payload => {
  assert.equal(payload.blocks.length, 3);
  assert.deepEqual(payload.blocks.map(b => b.text), ['same\n', 'same\n', 'broken\n']);
  assert(decodeBlockExportRequest({ type: 'requestBlockExport', requestId: 'r', payload }));
  return payload.blocks.map((block, i) => i === 2 ? { id: block.id, error: 'invalid source' } : { id: block.id,
    artifact: { kind: 'svg', data: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text>${i}</text></svg>`, width: 100, height: 40 } });
});
assert.equal((result.html.match(/class="meo-export-contributed /g) ?? []).length, 2);
assert.equal(result.warnings.length, 1); assert(result.html.includes('broken')); assert(result.html.includes('After'));
assert.match(result.html, /<blockquote\b/); assert.match(result.html, /<li\b/);
assert(!result.html.includes('data-meo-export-source'));
let calls = 0;
const github = renderMarkdownToHtml({ markdownText: markdown, markdownFilePath: 'fixture.md', target: 'html', preset: 'github-readme', exportBlockLanguages: ['third'] }).html;
await materializeContributedBlocks(github, snapshot, 'html', async () => { calls++; return []; }); assert.equal(calls, 0);
await materializeContributedBlocks(html, { ...snapshot, blockRenderers: [] }, 'html', async () => { calls++; return []; }); assert.equal(calls, 0);
assert.equal(decodeBlockExportResponse({ type: 'blockExportResult', requestId: 'x', result: { ok: true, value: [{ id: '0', artifact: { kind: 'svg', data: 'x', width: NaN, height: 3 } }] } }), null);
assert.equal(decodeBlockExportResponse({ type: 'blockExportResult', requestId: 'x', result: { ok: true, value: [{ id: '0', error: 'a' }, { id: '0', error: 'b' }] } }), null);
let request: any;
const transport = createBlockExportTransport(async message => { request = message; return true; });
const pending = transport.request({ blocks: [], renderers: [], styles: '', target: 'html', language: 'en', fontFamily: '', fontSize: 16, fontWeight: '400', codeFontFamily: '' });
assert(transport.accept({ type: 'blockExportResult', requestId: request.requestId, result: { ok: true, value: [] } }));
assert.deepEqual(await pending, []);
const closed = transport.request(request.payload); const rejected = assert.rejects(closed, /closed/); transport.close(); await rejected;
assert.equal(transport.accept({ type: 'blockExportResult', requestId: request.requestId, result: { ok: true, value: [] } }), false);
let snapshotReply: unknown;
const catalog = [{ ...renderer, codeBlockLanguages: ['third'] }];
const adapter = createExportWebviewAdapter({ postMessage: message => { snapshotReply = message; },
  getBlockRenderers: () => catalog, getCurrentText: () => 'frozen', whenDocumentIdle: async () => {}, getPreviewAppearance: () => 'light',
  getUiLanguage: () => 'en', getStyleEnvironment: () => ({ previewFontFamily: '' }),
  getCodeTheme: () => ({ name: 'test', type: 'light', colors: {}, tokenColors: [] }) });
adapter.accept({ type: 'requestExportSnapshot', requestId: 'freeze' }); await new Promise(resolve => setTimeout(resolve, 0));
catalog[0]!.codeBlockLanguages.push('changed');
const frozen = decodeExportSnapshotResponse(snapshotReply); assert(frozen?.result.ok);
assert.deepEqual(frozen.result.value.blockRenderers?.[0]?.codeBlockLanguages, ['third']); adapter.dispose();
console.log('PASS: generic export discovery, nested/duplicate source identity, fallbacks, protocol and lifecycle.');
