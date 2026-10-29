import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Browser } from 'puppeteer-core';
import sharp from 'sharp';
import { assessLargeDocument } from '../src/foundation/largeDocument';

const table = `<table>
<caption style="caption-side:bottom;padding:8px;font-size:13px">Caption</caption>
<colgroup><col span="2"><col></colgroup>
<thead><tr><th>类别</th><th>示例</th><th>状态</th></tr></thead>
<tbody>
<tr><td rowspan="2">文字效果</td><td>文字${'5'.repeat(55)}阴影</td><td>✓</td></tr>
<tr><td>上下标、插入与删除${'2'.repeat(30)}</td><td>✓</td></tr>
<tr><td colspan="2" style="background:#dbeafe;color:#1e40af;text-align:center;padding:12px">这是横跨两列的单元格</td><td>colspan</td></tr>
</tbody>
</table>`;

/** Timer samples follow resize delivery; compositor PNGs verify the actual paint. */
export async function checkHtmlTableLiveUpdates(browser: Browser, bundle: string, workerBundle: string): Promise<void> {
  for (const large of [false, true]) {
    const text = `Before.\n\n${table}\n\n<div id="html-update-witness">Unchanged HTML.</div>\n\n`
      + (large ? 'Background paragraph with enough text for the production document policy.\n\n'.repeat(16000) : 'After.');
    assert.equal(assessLargeDocument(text).windowedPreview, large);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.setViewport({ width: 1200, height: 1100 });
      await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
      await page.addStyleTag({ path: 'webview/src/styles.css' });
      const probeStyle = await page.addStyleTag({ content: '.meo-md-html-live-result th:nth-child(1){background:#ff00ff!important}.meo-md-html-live-result th:nth-child(2){background:#00ff00!important}.meo-md-html-live-result th:nth-child(3){background:#0000ff!important}' });
      await page.evaluate(code => {
        document.body.dataset.meoMarkdownWorkerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const NativeWorker = Worker;
        (window as any).htmlUpdateWorkerResults = 0;
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener('message', event => {
              if (event.data?.kind === 'blocks') (window as any).htmlUpdateWorkerResults++;
            });
          }
        };
      }, workerBundle);
      await page.addScriptTag({ content: bundle });
      await page.evaluate(({ text, appearance }) => {
        const g = window as any;
        document.body.className = `vscode-${appearance}`;
        g.applyTableTheme(appearance);
        g.widthEditor = g.createWidthEditor({ parent: document.getElementById('app'), text, initialMode: 'live' });
        const from = text.indexOf('<table>'), to = text.indexOf('</table>') + 8;
        g.enterHtmlSource(g.widthEditor.view, { from, to }, text.indexOf('Caption') + 7);
      }, { text, appearance: large ? 'dark' : 'light' });
      await page.waitForFunction(() => document.querySelector<HTMLTableElement>('.meo-md-html-live-result table')?.style.tableLayout === 'fixed');
      await page.waitForFunction(large => (window as any).usesTableDerivedBudget((window as any).widthEditor.view.state) === large, {}, large);
      if (large) await page.waitForFunction(() => (window as any).htmlUpdateWorkerResults > 0);
      assert.ok(await page.$('#html-update-witness'), 'The unchanged HTML positive control is mounted');
      await page.evaluate(() => {
        const g = window as any;
        g.unchangedHtml = document.querySelector('#html-update-witness');
        g.htmlUpdateSamples = [];
        const sentinel = document.createElement('div');
        sentinel.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none';
        document.body.append(sentinel);
        let frame = 0;
        g.htmlUpdateObserver = new ResizeObserver(() => setTimeout(() => {
          const table = document.querySelector<HTMLTableElement>('.meo-md-html-live-result table');
          if (!table) return;
          g.htmlUpdateSamples.push({ frame, caption: table.caption?.textContent, content: table.rows[1]?.cells[1]?.textContent,
            layout: table.style.tableLayout, host: table.parentElement!.clientWidth,
            widths: Array.from(table.rows[0].cells).map(cell => cell.getBoundingClientRect().width) });
        }, 0));
        g.htmlUpdateObserver.observe(sentinel);
        function tick() { sentinel.style.width = `${1 + frame++ % 2}px`; g.htmlUpdateFrame = requestAnimationFrame(tick); }
        g.htmlUpdateFrame = requestAnimationFrame(tick);
      });
      const client = await page.createCDPSession();
      const painted: Buffer[] = [];
      client.on('Page.screencastFrame', event => {
        painted.push(Buffer.from(event.data, 'base64'));
        void client.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      });
      await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      const checkFrames = async (caption: string, content?: string) => {
        await page.waitForFunction(({ caption, content }) => {
          const samples = (window as any).htmlUpdateSamples;
          return samples.slice(-4).length === 4 && samples.slice(-4).every((sample: any) => sample.caption === caption
            && (content === undefined || sample.content === content));
        }, {}, { caption, content });
        const samples = await page.evaluate(() => (window as any).htmlUpdateSamples) as {
          frame: number; caption: string; content: string; layout: string; host: number; widths: number[];
        }[];
        const changed = samples.filter(sample => sample.caption === caption && (content === undefined || sample.content === content));
        const final = changed.at(-1)!;
        assert.ok(changed.length >= 4);
        assert.ok(changed.every(sample => sample.layout === 'fixed' && sample.widths.every((width, index) => Math.abs(width - final.widths[index]) <= 0.5)),
          `HTML table transient column widths (${large ? 'optimized' : 'ordinary'}): ${JSON.stringify(changed)}`);
        assert.equal(await page.evaluate(() => (window as any).unchangedHtml === document.querySelector('#html-update-witness')), true,
          'Editing this block retains unrelated HTML nodes');
      };
      await page.keyboard.type('789', { delay: 80 });
      await checkFrames('Caption789');
      assert.equal(await page.evaluate(() => (window as any).widthEditor.getText()), text.replace('Caption', 'Caption789'));
      await page.evaluate(() => {
        const view = (window as any).widthEditor.view, source = view.state.doc.toString();
        view.dispatch({ selection: { anchor: source.indexOf('阴影') } }); view.focus();
      });
      await page.keyboard.type('6789', { delay: 80 });
      await checkFrames('Caption789', `文字${'5'.repeat(55)}6789阴影`);
      const edited = text.replace('Caption', 'Caption789').replace('阴影', '6789阴影');
      assert.equal(await page.evaluate(() => (window as any).widthEditor.getText()), edited);
      assert.equal(await page.evaluate(() => {
        const view = (window as any).widthEditor.view;
        return view.state.doc.sliceString(view.state.selection.main.head - 4, view.state.selection.main.head);
      }), '6789', 'Native input retains its caret');
      await page.evaluate(() => (window as any).undoTableInput((window as any).widthEditor.view));
      await checkFrames('Caption789', `文字${'5'.repeat(55)}阴影`);
      await page.evaluate(() => (window as any).redoTableInput((window as any).widthEditor.view));
      await checkFrames('Caption789', `文字${'5'.repeat(55)}6789阴影`);
      assert.equal(await page.evaluate(() => (window as any).widthEditor.getText()), edited, 'History preserves raw HTML');
      await client.send('Page.stopScreencast');
      await client.detach();
      const samples = await page.evaluate(() => (window as any).htmlUpdateSamples) as { widths: number[]; content: string; layout: string }[];
      assert.ok(samples.every(sample => sample.layout === 'fixed'), 'Every sampled input state retains fitted columns');
      const accepted = [...new Map(samples.map(sample => [sample.content, sample.widths])).values()];
      assert.ok(painted.length >= 6, 'The compositor supplies input frames, not only a final screenshot');
      for (const [index, png] of painted.entries()) {
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let widths: number[] | null = null;
        for (let y = 0; y < info.height; y++) {
          const counts = [0, 0, 0];
          for (let x = 0; x < info.width; x++) {
            const offset = (y * info.width + x) * info.channels;
            const r = data[offset], g = data[offset + 1], b = data[offset + 2];
            if (r === 255 && g === 0 && b === 255) counts[0]++;
            if (r === 0 && g === 255 && b === 0) counts[1]++;
            if (r === 0 && g === 0 && b === 255) counts[2]++;
          }
          if (counts.every(count => count > 50)) { widths = counts; break; }
        }
        assert.ok(widths, `Painted input frame ${index} must show the table header`);
        assert.ok(accepted.some(expected => widths!.every((width, column) => Math.abs(width - expected[column]) <= 3)),
          `Painted table columns flash (${large ? 'optimized' : 'ordinary'}, frame ${index}): ${JSON.stringify({ widths, accepted })}`);
      }
      await probeStyle.evaluate(style => style.remove());
      fs.mkdirSync('.local/html-table-update-audit', { recursive: true });
      await page.screenshot({ path: `.local/html-table-update-audit/${large ? 'optimized' : 'ordinary'}.png` });
      await page.evaluate(() => {
        const g = window as any;
        cancelAnimationFrame(g.htmlUpdateFrame); g.htmlUpdateObserver.disconnect();
        g.widthEditor.setMode('source');
      });
      await page.waitForFunction(() => document.querySelector('.meo-md-html-content table') === null);
      await page.evaluate(() => (window as any).widthEditor.setMode('live'));
      await page.waitForFunction(() => document.querySelector<HTMLTableElement>('.meo-md-html-content table')?.style.tableLayout === 'fixed');
      assert.equal(await page.evaluate(() => (window as any).widthEditor.getText()), edited);
      await page.evaluate(text => {
        const editor = (window as any).widthEditor;
        editor.setText(text, true); editor.view.dispatch({ selection: { anchor: 0 } });
      }, text.replace(table, `<details open>\n<summary>Reveal table</summary>\n${table}\n</details>`));
      await page.waitForSelector('.meo-md-html-content summary');
      await page.evaluate(() => (window as any).widthEditor.whenVisiblePresentationReady(2000));
      await page.click('.meo-md-html-content summary');
      await page.waitForFunction(() => {
        const details = document.querySelector<HTMLDetailsElement>('.meo-md-html-content details');
        return details && !details.open;
      });
      await page.evaluate(() => (window as any).widthEditor.whenVisiblePresentationReady(2000));
      await page.waitForSelector('.meo-md-html-content summary', { visible: true });
      await page.click('.meo-md-html-content summary');
      await page.waitForFunction(() => {
        const table = document.querySelector<HTMLTableElement>('.meo-md-html-content details table');
        return table?.getBoundingClientRect().height && table.style.tableLayout === 'fixed';
      });
      await page.evaluate(() => {
        const editor = (window as any).widthEditor;
        editor.view.dispatch({ changes: { from: 0, insert: 'pending' }, userEvent: 'input.type' });
        editor.destroy(); (window as any).widthEditor = null;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(errors, []);
      console.log(`HTML table ${large ? 'optimized' : 'ordinary'}: ${painted.length} compositor frames, remount/reveal and pending-update disposal passed`);
    } finally {
      await page.evaluate(() => (window as any).widthEditor?.destroy());
      await page.close();
    }
  }
  console.log('HTML table updates: compositor column widths, native typing, merged cells, unchanged nodes, history and real Worker/large-document budget passed');
}
