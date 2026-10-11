import assert from 'node:assert/strict';
import path from 'node:path';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

const build = await Bun.build({
  entrypoints: [path.resolve(import.meta.dir, 'test-source-lightweight-shiki-entry.ts')],
  target: 'browser', format: 'iife'
});
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewport({ width: 1100, height: 700 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addStyleTag({ path: path.resolve(import.meta.dir, '../webview/src/styles.css') });
  await page.addStyleTag({ content: ':root{--meo-background:#24292e;--meo-source-foreground:#cccccc;--meo-foreground:#cccccc;--meo-font-source:monospace;--meo-font-source-weight:400;--meo-font-source-size:14px;--meo-line-height-source:1.5}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  // More than one token batch and one viewport, with unique text for style comparison.
  const text = Array.from({ length: 48 }, (_, i) => `## Heading ${i}\n\nBody ${i} **bold** *italic* [link](https://example.com)\n`).join('\n');
  await page.evaluate(text => {
    const harness = (window as any).SourceLightweightShikiHarness;
    harness.applyTheme();
    (window as any).__sourceSyntaxEditor = harness.createEditor({ parent: document.getElementById('app'), text, initialMode: 'source', onApplyChanges() {} });
  }, text);
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const observe = () => page.evaluate(() => {
    let uncolored = 0;
    const styles: Record<string, string[]> = {};
    for (const line of document.querySelectorAll<HTMLElement>('.cm-content .cm-line')) {
      const rect = line.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight || !line.textContent?.trim()) continue;
      const chars: string[] = [];
      const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const node = walk.currentNode, style = getComputedStyle(node.parentElement!);
        if (node.textContent?.trim() && !node.parentElement?.closest('.meo-source-token')) uncolored++;
        for (const _ of node.textContent!) chars.push(`${style.color}/${style.fontWeight}/${style.fontStyle}/${style.textDecorationLine}`);
      }
      styles[line.textContent] = chars;
    }
    return { uncolored, styles };
  });
  await page.waitForSelector('.meo-source-token');
  await page.evaluate(() => (window as any).__sourceSyntaxEditor.scrollToLine(141, 'top'));
  await frames();
  const expected = await observe();
  assert.equal(expected.uncolored, 0);
  assert.ok(expected.styles['## Heading 35'], 'The reference viewport must contain the remote heading');
  await page.evaluate(() => (window as any).__sourceSyntaxEditor.scrollToLine(1, 'top'));
  await frames();
  await page.evaluate(() => {
    // Hold only the asynchronous batch boundary, using the actual token runtime.
    // A fast machine must exercise the same pending interval as a long document.
    const NativeChannel = MessageChannel;
    (window as any).__pendingSourceBatches = [];
    (window as any).__holdSourceBatches = true;
    (window as any).MessageChannel = class {
      port1: MessagePort;
      port2: MessagePort;
      constructor() {
        const channel = new NativeChannel();
        this.port1 = channel.port1;
        this.port2 = channel.port2;
        Object.defineProperty(this.port1, 'onmessage', { set(listener) {
          channel.port1.addEventListener('message', event => {
            const deliver = () => listener.call(channel.port1, event);
            if ((window as any).__holdSourceBatches) (window as any).__pendingSourceBatches.push(deliver);
            else deliver();
          });
          channel.port1.start();
        } });
      }
    };
    const editor = (window as any).__sourceSyntaxEditor;
    editor.view.dispatch({ changes: { from: 0, insert: 'First inserted paragraph\n\n' } });
    editor.view.dispatch({ changes: { from: 0, insert: 'Second inserted paragraph\n\n' } });
    editor.scrollToLine(145, 'top');
  });
  await page.waitForFunction(() => (window as any).__pendingSourceBatches.length > 0);
  await frames();
  const pending = await observe();
  assert.equal(pending.uncolored, 0, 'Newly visible unchanged text must retain its colors while tokens are pending');
  assert.deepEqual(pending.styles, expected.styles, 'Successive edits must map the last completed colors to the new viewport');
  await page.evaluate(() => {
    const editor = (window as any).__sourceSyntaxEditor;
    const documentText = editor.getText();
    const from = documentText.indexOf('## Heading 35');
    editor.view.dispatch({ changes: { from, to: from + '## Heading 35'.length, insert: 'Plain replacement' } });
  });
  await frames();
  assert.equal(await page.$eval('.cm-content', content => [...content.querySelectorAll('.cm-line')]
    .find(line => line.textContent === 'Plain replacement')?.querySelector('.meo-source-token') === null), true,
  'Changed text must not inherit stale heading formatting');
  await page.evaluate(() => {
    (window as any).__holdSourceBatches = false;
    for (const deliver of (window as any).__pendingSourceBatches.splice(0)) deliver();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.meo-source-token')].some(el => el.textContent === 'Plain replacement'));
  const ready = await observe();
  assert.equal(ready.uncolored, 0);
  assert.ok(ready.styles['Plain replacement']?.every(style => style === expected.styles['Body 35 **bold** *italic* [link](https://example.com)']![0]), 'The latest tokens must replace the obsolete heading style');
  assert.deepEqual(ready.styles['Body 35 **bold** *italic* [link](https://example.com)'], expected.styles['Body 35 **bold** *italic* [link](https://example.com)']);
  await page.evaluate(() => {
    (window as any).__holdSourceBatches = true;
    const editor = (window as any).__sourceSyntaxEditor;
    editor.view.dispatch({ changes: { from: 0, to: editor.getText().length, insert: 'Entire replacement paragraph\n'.repeat(192) } });
    editor.scrollToLine(141, 'top');
  });
  await page.waitForFunction(() => (window as any).__pendingSourceBatches.length > 0);
  await frames();
  assert.equal(await page.$$eval('.meo-source-token', tokens => tokens.length), 0, 'A whole-document replacement must release every obsolete token');
  await page.evaluate(() => {
    (window as any).__holdSourceBatches = false;
    for (const deliver of (window as any).__pendingSourceBatches.splice(0)) deliver();
  });
  await page.waitForSelector('.meo-source-token');
  assert.equal((await observe()).uncolored, 0);
  await page.evaluate(() => (window as any).__sourceSyntaxEditor.destroy());
  assert.deepEqual(errors, []);
  console.log('Source syntax stability: pending edits, viewport recoloring, successive position mappings and latest-token publication passed.');
} finally { await closeTestBrowser(browser); }
