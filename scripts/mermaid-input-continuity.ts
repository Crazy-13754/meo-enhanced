import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { Browser } from 'puppeteer-core';
import { assessLargeDocument } from '../src/foundation/largeDocument';

export async function checkMermaidInputContinuity(browser: Browser, bundle: string): Promise<void> {
  const worker = await Bun.build({ entrypoints: ['webview/src/markdownParseWorker.ts'], target: 'browser', format: 'iife' });
  assert.ok(worker.success);
  for (const large of [false, true]) for (const layout of ['stacked', 'side-by-side']) {
    const text = 'Before.\n\n```mermaid\nflowchart LR\nA[Alpha] --> B[Beta]\nB --> C[Gamma]\nC --> D[Delta]\n```\n\nAfter.\n\n'
      + (large ? 'Background paragraph for actual document optimization.\n\n'.repeat(21000) : '');
    assert.equal(assessLargeDocument(text).boundedEditorWork, large);
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.setViewport({ width: 1100, height: 1100 });
      await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
      await page.addStyleTag({ path: 'webview/src/styles.css' });
      await page.addStyleTag({ content: '.meo-mermaid-block svg .node rect{fill:#fc02dc!important}' });
      await page.evaluate(code => {
        document.body.dataset.meoMarkdownWorkerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const NativeWorker = Worker;
        (window as any).mermaidContinuityWorkers = 0;
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener('message', event => { if (event.data?.kind === 'blocks') (window as any).mermaidContinuityWorkers++; });
          }
        };
      }, await worker.outputs[0].text());
      await page.addScriptTag({ path: 'webview/dist/mermaid.min.js' });
      await page.addScriptTag({ content: bundle });
      await page.evaluate(text => {
        const g = window as any, api = g.MermaidEditingHarness;
        api.applyBuiltInVisualBaseline('light');
        g.continuityEditor = api.createEditor({ parent: document.getElementById('app'), text, initialMode: 'live' });
      }, text);
      await page.waitForSelector('.meo-mermaid-block svg');
      await page.evaluate(({ text, layout }) => {
        const g = window as any, view = g.continuityEditor.view, anchor = text.indexOf('```');
        g.MermaidEditingHarness.focusMermaidEditingOffset(view, anchor, 0);
        view.dispatch({ effects: g.MermaidEditingHarness.setMermaidLayoutEffect.of({ anchor, layout }), selection: { anchor: text.indexOf('Alpha') + 5 } });
        view.focus();
      }, { text, layout });
      await page.waitForFunction(large => (window as any).MermaidEditingHarness.usesLargeDocumentDerivedWorkBudget((window as any).continuityEditor.view.state) === large, {}, large);
      await page.evaluate(() => (window as any).continuityEditor.whenVisiblePresentationReady(3000));
      if (large) await page.waitForFunction(() => (window as any).mermaidContinuityWorkers > 0);
      await page.evaluate(() => {
        const g = window as any;
        g.continuitySamples = []; g.continuityIds = new WeakMap(); let nextId = 0, frame = 0;
        const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none'; document.body.append(probe);
        g.continuityObserver = new ResizeObserver(() => setTimeout(() => {
          const svg = document.querySelector<SVGElement>('.meo-mermaid-editing-preview .meo-mermaid-block svg');
          if (!svg) { g.continuitySamples.push({ frame, missing: true }); return; }
          if (!g.continuityIds.has(svg)) g.continuityIds.set(svg, ++nextId);
          const box = svg.getBoundingClientRect();
          g.continuitySamples.push({ frame, id: g.continuityIds.get(svg), label: svg.querySelector('.nodeLabel')?.textContent, width: box.width, height: box.height });
        }, 0));
        g.continuityObserver.observe(probe);
        function tick() { probe.style.width = `${1 + frame++ % 2}px`; g.continuityFrame = requestAnimationFrame(tick); }
        g.continuityFrame = requestAnimationFrame(tick);
      });
      await page.waitForFunction(() => { const samples = (window as any).continuitySamples; return samples.length >= 3 && samples.slice(-3).every((sample: any) => !sample.missing && sample.label === 'Alpha'); });
      const client = await page.createCDPSession(), painted: Buffer[] = [];
      client.on('Page.screencastFrame', event => { painted.push(Buffer.from(event.data, 'base64')); void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }); });
      await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      await page.keyboard.type('7');
      await page.waitForFunction(() => { const samples = (window as any).continuitySamples; return samples.slice(-6).length === 6 && samples.slice(-6).every((sample: any) => !sample.missing && sample.label === 'Alpha7'); });
      await client.send('Page.stopScreencast'); await client.detach();
      const samples = await page.evaluate(() => {
        const g = window as any; cancelAnimationFrame(g.continuityFrame); g.continuityObserver.disconnect(); return g.continuitySamples;
      }) as { missing?: boolean; id: number; width: number; height: number }[];
      assert.ok(samples.every(sample => !sample.missing), `${layout}/${large}: accepted diagram disappeared: ${JSON.stringify(samples)}`);
      for (const id of new Set(samples.map(sample => sample.id))) {
        const group = samples.filter(sample => sample.id === id);
        assert.ok(Math.max(...group.map(sample => sample.width)) - Math.min(...group.map(sample => sample.width)) <= 0.5);
        assert.ok(Math.max(...group.map(sample => sample.height)) - Math.min(...group.map(sample => sample.height)) <= 0.5);
      }
      assert.ok(painted.length >= 3);
      for (const png of painted) {
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let pixels = 0;
        for (let index = 0; index < data.length; index += info.channels) if (data[index] === 252 && data[index + 1] === 2 && data[index + 2] === 220) pixels++;
        assert.ok(pixels > 1000, `${layout}/${large}: painted diagram was cleared`);
      }
      assert.equal(await page.evaluate(() => (window as any).continuityEditor.getText()), text.replace('Alpha', 'Alpha7'));
      // A new selection and removal must retire the retained panel immediately.
      await page.evaluate(() => {
        const view = (window as any).continuityEditor.view;
        view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('After.') } });
      });
      await page.waitForFunction(() => !document.querySelector('.meo-mermaid-inline-preview'));
      await page.evaluate(() => {
        const g = window as any, view = g.continuityEditor.view, source = view.state.doc.toString(), from = source.indexOf('```'), to = source.indexOf('```', from + 3) + 3;
        g.MermaidEditingHarness.focusMermaidEditingOffset(view, from, 0);
        view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from }, userEvent: 'input.delete' });
      });
      await page.waitForFunction(() => !document.querySelector('.meo-mermaid-inline-preview, .meo-mermaid-block'));
      assert.deepEqual(errors, []);
      console.log(`Mermaid continuity ${large ? 'optimized' : 'ordinary'}/${layout}: ${painted.length} compositor frames, real Worker/rendering, selection and removal passed`);
    } finally {
      await page.evaluate(() => (window as any).continuityEditor?.destroy()); await page.close();
    }
  }
}
