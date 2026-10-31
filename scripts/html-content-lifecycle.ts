import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import type { Browser } from 'puppeteer-core';
import { assessLargeDocument } from '../src/foundation/largeDocument';

export async function checkHtmlContentLifecycle(browser: Browser, bundle: string): Promise<void> {
  const worker = await Bun.build({ entrypoints: ['webview/src/markdownParseWorker.ts'], target: 'browser', format: 'iife' });
  assert.ok(worker.success);
  const png = await sharp({ create: { width: 260, height: 90, channels: 3, background: '#fc02dc' } }).png().toBuffer();
  const image = 'data:image/png;base64,' + png.toString('base64');
  const wav = Buffer.alloc(44 + 8000 * 10, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audio = 'data:audio/wav;base64,' + wav.toString('base64');
  const block = `<section>
<p>Caption</p>
<picture id="lifecycle-picture"><source srcset="picture.png 1x"><img src="picture.png" alt="Picture"></picture>
<img id="lifecycle-responsive" src="responsive.png" srcset="responsive.png 1x" alt="Responsive">
<audio id="lifecycle-audio" controls src="silent.wav"></audio>
<input id="lifecycle-input" value="Authored"><a href="https://example.com/old">Current link</a>
<details id="lifecycle-details"><summary>Disclosure</summary><p>Nested details.</p></details>

**Markdown inside the root.**

</section>`;
  for (const large of [false, true]) {
    const tail = large ? 'Background paragraph for production document optimization.\n\n'.repeat(19000) : '';
    const text = `Before.\n\n${block}\n**Independent prose**\n<div id="lifecycle-independent">Separate root</div>\n\nAfter.\n\n${tail}`;
    assert.equal(assessLargeDocument(text).boundedEditorWork, large);
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.setViewport({ width: 1100, height: 1200 });
      await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
      await page.addStyleTag({ path: 'webview/src/styles.css' });
      await page.evaluate(code => {
        document.body.dataset.meoMarkdownWorkerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const NativeWorker = Worker;
        (window as any).htmlLifecycleWorkerResults = 0;
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener('message', event => { if (event.data?.kind === 'blocks') (window as any).htmlLifecycleWorkerResults++; });
          }
        };
      }, await worker.outputs[0].text());
      await page.addScriptTag({ content: bundle });
      const commits = await page.evaluate(async image => {
        const root = document.createElement('div'), img = document.createElement('img');
        img.setAttribute('data-meo-html-src', 'unchanged.png'); root.append(img); document.body.append(root);
        const queue: Array<() => void> = [], calls: string[] = [];
        const resolve = (owner: string, signal: AbortSignal) => (window as any).HtmlContentHarness.resolveHtmlResources(root, {
          signal, resolve: async () => { calls.push(owner); return image + '#' + owner; }, commit: (apply: () => void) => queue.push(apply)
        });
        const oldOwner = new AbortController(), newOwner = new AbortController();
        resolve('old', oldOwner.signal); await new Promise(resolve => setTimeout(resolve, 0));
        resolve('new', newOwner.signal); await new Promise(resolve => setTimeout(resolve, 0));
        resolve('duplicate', newOwner.signal); await new Promise(resolve => setTimeout(resolve, 0));
        queue[0](); const stale = img.getAttribute('src'); queue[1]();
        const current = img.getAttribute('src'); root.remove();
        return { calls, stale, current: current?.endsWith('#new') };
      }, image);
      assert.deepEqual(commits, { calls: ['old', 'new'], stale: null, current: true }, 'Queued native commits deduplicate only within the same owner and reject superseded replies');
      await page.evaluate(({ text, image, audio }) => {
        const g = window as any, api = g.HtmlContentHarness;
        api.applyUiTheme('light', false); g.htmlLifecycleCalls = []; g.htmlLifecycleReleases = []; g.htmlLifecycleLinks = [];
        g.htmlLifecycleHold = true;
        api.setImageSrcResolver(async (url: string) => {
          g.htmlLifecycleCalls.push(url);
          if (g.htmlLifecycleHold) await new Promise(resolve => g.htmlLifecycleReleases.push(resolve));
          else await new Promise(resolve => setTimeout(resolve, 60));
          return url.endsWith('.wav') ? audio : image;
        });
        g.htmlLifecycleEditor = api.createEditor({ parent: document.getElementById('app'), text, initialMode: 'live',
          onOpenLink: (href: string) => g.htmlLifecycleLinks.push(href) });
        api.enterHtmlSource(g.htmlLifecycleEditor.view, { from: text.indexOf('<section>'), to: text.indexOf('</section>') + 10 }, text.indexOf('Caption') + 7);
      }, { text, image, audio });
      await page.waitForFunction(large => (window as any).HtmlContentHarness.usesLargeDocumentDerivedWorkBudget((window as any).htmlLifecycleEditor.view.state) === large, {}, large);
      await page.waitForFunction(() => document.querySelector('.meo-md-html-live-result p')?.textContent === 'Caption'
        && (window as any).htmlLifecycleCalls.length >= 5);
      if (large) await page.waitForFunction(() => (window as any).htmlLifecycleWorkerResults > 0);
      await page.waitForSelector('#lifecycle-independent');
      const independent = await page.evaluate(() => {
        const first = document.querySelector('.meo-md-html-live-result');
        const next = document.getElementById('lifecycle-independent')!;
        return first !== next.closest('.meo-md-html-block') && !first?.textContent?.includes('Independent prose')
          && [...document.querySelectorAll('.cm-line')].some(line => line.textContent?.includes('Independent prose')
            && !line.classList.contains('meo-md-html-source-range'));
      });
      assert.equal(independent, true, 'Adjacent roots and intervening Markdown keep independent source ownership');
      await page.evaluate(() => {
        const g = window as any;
        g.htmlLifecycleOriginal = ['lifecycle-picture', 'lifecycle-responsive', 'lifecycle-audio', 'lifecycle-input', 'lifecycle-details'].map(id => document.getElementById(id));
        g.htmlLifecycleInitialCalls = g.htmlLifecycleCalls.length;
        g.htmlLifecycleIndependent = document.getElementById('lifecycle-independent');
      });
      await page.keyboard.type('7');
      await page.waitForFunction(() => document.querySelector('.meo-md-html-live-result p')?.textContent === 'Caption7');
      assert.equal(await page.evaluate(() => (window as any).htmlLifecycleCalls.length === (window as any).htmlLifecycleInitialCalls), true,
        'Typing during initial resolution must reuse the pending native requests');
      await page.evaluate(() => { const g = window as any; g.htmlLifecycleHold = false; g.htmlLifecycleReleases.splice(0).forEach((release: () => void) => release()); });
      await page.waitForFunction(() => {
        const root = document.querySelector('.meo-md-html-live-result');
        const images = Array.from(root?.querySelectorAll('img') ?? []);
        return images.length === 2 && images.every(img => img.naturalWidth === 260) && root!.querySelector('audio')!.readyState >= 2;
      });
      await page.evaluate(async () => {
        const g = window as any, media = document.querySelector('audio')!;
        media.muted = true; await media.play();
        document.querySelector<HTMLInputElement>('#lifecycle-input')!.value = 'Runtime value';
        document.querySelector<HTMLDetailsElement>('#lifecycle-details')!.open = true;
        g.htmlLifecycleSamples = [];
        const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;background:#010203'; document.body.append(probe);
        let frame = 0;
        g.htmlLifecycleObserver = new ResizeObserver(() => setTimeout(() => {
          const root = document.querySelector<HTMLElement>('.meo-md-html-live-result .meo-md-html-content');
          if (root) g.htmlLifecycleSamples.push({ caption: root.querySelector('p')?.textContent, height: root.getBoundingClientRect().height,
            loaded: Array.from(root.querySelectorAll('img')).every(img => img.naturalWidth === 260), frame });
        }, 0));
        g.htmlLifecycleObserver.observe(probe);
        function tick() {
          probe.style.width = `${1 + frame++ % 2}px`;
          probe.style.backgroundColor = frame % 2 ? '#010203' : '#040506';
          g.htmlLifecycleFrame = requestAnimationFrame(tick);
        }
        g.htmlLifecycleFrame = requestAnimationFrame(tick);
      });
      await page.waitForFunction(() => document.querySelector('audio')!.currentTime > 0.15);
      const client = await page.createCDPSession(), painted: Buffer[] = [];
      let firstPaintReady!: () => void, enoughPaintsReady!: () => void;
      const firstPaint = new Promise<void>(resolve => { firstPaintReady = resolve; });
      const enoughPaints = new Promise<void>(resolve => { enoughPaintsReady = resolve; });
      const waitForPaint = async (ready: Promise<void>) => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([ready, new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error(`Native HTML compositor delivery timed out (${large}, ${painted.length} frames)`)), 5000);
          })]);
        } finally { if (deadline !== undefined) clearTimeout(deadline); }
      };
      client.on('Page.screencastFrame', event => {
        painted.push(Buffer.from(event.data, 'base64'));
        if (painted.length >= 1) firstPaintReady();
        if (painted.length >= 3) enoughPaintsReady();
        void client.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      });
      await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      await waitForPaint(firstPaint);
      await page.keyboard.type('8');
      await page.waitForFunction(() => { const samples = (window as any).htmlLifecycleSamples; return samples.length > 10 && samples.slice(-5).every((sample: any) => sample.caption === 'Caption78'); });
      await waitForPaint(enoughPaints);
      const finalPaint = Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
      await client.send('Page.stopScreencast'); await client.detach();
      const result = await page.evaluate(() => {
        const g = window as any;
        cancelAnimationFrame(g.htmlLifecycleFrame); g.htmlLifecycleObserver.disconnect();
        return { samples: g.htmlLifecycleSamples, same: g.htmlLifecycleOriginal.every((node: Element) => node === document.getElementById(node.id)),
          identities: g.htmlLifecycleOriginal.map((node: Element) => ({ id: node.id, same: node === document.getElementById(node.id) })),
          paused: document.querySelector('audio')!.paused, time: document.querySelector('audio')!.currentTime,
          input: document.querySelector<HTMLInputElement>('#lifecycle-input')!.value, calls: g.htmlLifecycleCalls.length, initialCalls: g.htmlLifecycleInitialCalls };
      });
      assert.ok(result.same && !result.paused && result.time > 0.15 && result.input === 'Runtime value', JSON.stringify({ identities: result.identities, paused: result.paused, time: result.time, input: result.input }));
      assert.equal(await page.$eval('#lifecycle-details', node => (node as HTMLDetailsElement).open), true);
      assert.equal(result.calls, result.initialCalls, 'Unchanged resources must not resolve again');
      assert.equal(await page.evaluate(() => (window as any).htmlLifecycleIndependent === document.getElementById('lifecycle-independent')), true,
        'Typing in the first root retains the independent following root');
      assert.ok(result.samples.every((sample: any) => sample.loaded && Math.abs(sample.height - result.samples.at(-1).height) <= 0.5));
      assert.ok(painted.length >= 3);
      for (const png of [...painted, finalPaint]) {
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let pixels = 0;
        for (let index = 0; index < data.length; index += info.channels) if (data[index] === 252 && data[index + 1] === 2 && data[index + 2] === 220) pixels++;
        assert.ok(pixels >= 40000, `Unchanged native pictures disappeared in a painted frame: ${pixels}`);
      }
      assert.equal(await page.evaluate(() => (window as any).htmlLifecycleEditor.getText()), text.replace('Caption', 'Caption78'));
      fs.mkdirSync('.local/html-lifecycle-acceptance', { recursive: true });
      await page.screenshot({ path: `.local/html-lifecycle-acceptance/${large ? 'optimized' : 'ordinary'}.png` });
      // A changed URL is a new resource, while sibling playback stays accepted.
      await page.evaluate(() => {
        const view = (window as any).htmlLifecycleEditor.view, source = view.state.doc.toString(), from = source.indexOf('picture.png');
        view.dispatch({ changes: { from, to: from + 11, insert: 'changed.png' }, userEvent: 'input.type' });
      });
      await page.waitForFunction(() => (window as any).htmlLifecycleCalls.includes('changed.png'));
      assert.equal(await page.evaluate(() => document.querySelector('audio') === (window as any).htmlLifecycleOriginal[2] && !document.querySelector('audio')!.paused), true);
      await page.evaluate(() => {
        const g = window as any, view = g.htmlLifecycleEditor.view, source = view.state.doc.toString(), from = source.indexOf('<audio'), to = source.indexOf('</audio>') + 8;
        view.dispatch({ changes: { from, to, insert: '' }, userEvent: 'input.type' });
      });
      await page.waitForFunction(() => document.querySelector('audio') === null);
      assert.equal(await page.evaluate(() => (window as any).htmlLifecycleOriginal[2].paused), true, 'Removed media is disposed');
      await page.evaluate(() => {
        const view = (window as any).htmlLifecycleEditor.view, source = view.state.doc.toString(), from = source.indexOf('https://example.com/old');
        view.dispatch({ changes: { from, to: from + 23, insert: 'https://example.com/new' }, userEvent: 'input.type' });
      });
      await page.waitForFunction(() => document.querySelector('.meo-md-html-live-result a')?.getAttribute('href') === 'https://example.com/new');
      await page.keyboard.down('Control'); await page.click('.meo-md-html-live-result a'); await page.keyboard.up('Control');
      assert.deepEqual(await page.evaluate(() => (window as any).htmlLifecycleLinks), ['https://example.com/new'], 'Reused anchors resolve the current URL');
      await page.evaluate(() => {
        const view = (window as any).htmlLifecycleEditor.view, source = view.state.doc.toString(), from = source.indexOf(' href="https://example.com/new"');
        view.dispatch({ changes: { from, to: from + 31, insert: '' }, userEvent: 'input.type' });
      });
      await page.waitForFunction(() => !document.querySelector('.meo-md-html-live-result a')?.hasAttribute('href'));
      await page.keyboard.down('Control'); await page.click('.meo-md-html-live-result a'); await page.keyboard.up('Control');
      assert.deepEqual(await page.evaluate(() => (window as any).htmlLifecycleLinks), ['https://example.com/new'], 'Removing href retires the old navigation action');
      // Multiple disjoint edits become one synchronization envelope on reload.
      const disk = '<div>\nParagraph **bold**.\n\n- Markdown list\n\n</div>\n\n## Next heading\n\n$$\nx^2 + 1\n$$\n\n<svg width="300" height="140" viewBox="0 0 300 140"><text x="10" y="30">Image</text></svg>\n\nAfter.\n\n' + tail;
      await page.evaluate(text => {
        const g = window as any, editor = g.htmlLifecycleEditor;
        editor.setText(text, true); g.HtmlContentHarness.enterHtmlSource(editor.view, { from: text.indexOf('<svg'), to: text.indexOf('</svg>') + 6 }, text.indexOf('Edited image') + 3);
      }, disk.replace('Paragraph', 'Edited paragraph').replace('Image', 'Edited image'));
      for (let reload = 0; reload < 2; reload++) {
        await page.evaluate(text => (window as any).htmlLifecycleEditor.setText(text, true), disk);
        await page.evaluate(() => (window as any).htmlLifecycleEditor.whenVisiblePresentationReady(2500));
        await page.waitForFunction(() => document.querySelectorAll('.meo-md-html-source-invalid').length === 0
          && document.querySelectorAll('.meo-md-html-content svg[viewBox]').length === 1
          && document.querySelectorAll('.meo-md-math-fenced-display').length === 1);
        const scope = await page.evaluate(() => {
          const g = window as any, view = g.htmlLifecycleEditor.view, range = g.HtmlContentHarness.getHtmlEditingRange(view.state);
          return { source: range ? view.state.doc.sliceString(range.from, range.to) : null,
            svg: view.dom.querySelectorAll('.meo-md-html-content svg[viewBox]').length, undo: g.HtmlContentHarness.undo(view), text: g.htmlLifecycleEditor.getText() };
        });
        assert.ok(!scope.source || scope.source.startsWith('<svg') && !scope.source.includes('## Next heading'));
        assert.equal(scope.svg, 1, 'One reload must produce exactly one authored SVG');
        assert.equal(scope.undo, false, 'Reload retires old history'); assert.equal(scope.text, disk);
      }
      assert.deepEqual(errors, []);
      console.log(`HTML lifecycle ${large ? 'optimized' : 'ordinary'}: ${painted.length} compositor frames, pending/loaded resource reuse, playback, controls, URL change, removal and single/equal-text reload passed`);
    } finally {
      await page.evaluate(() => (window as any).htmlLifecycleEditor?.destroy()); await page.close();
    }
  }
}
