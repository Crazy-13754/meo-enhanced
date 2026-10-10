import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

async function paintedRows(encoded: string) {
  const { data, info } = await sharp(Buffer.from(encoded, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let contentTop = -1, gutterTop = -1;
  for (let y = 0; y < info.height && (contentTop < 0 || gutterTop < 0); y++) {
    let cyan = 0, magenta = 0;
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const r = data[offset]!, g = data[offset + 1]!, b = data[offset + 2]!;
      if (r < 80 && g > 170 && b > 170) cyan++;
      if (r > 170 && g < 80 && b > 170) magenta++;
    }
    if (contentTop < 0 && cyan >= 3) contentTop = y;
    if (gutterTop < 0 && magenta >= 2) gutterTop = y;
  }
  return { contentTop, gutterTop };
}

const build = await Bun.build({ entrypoints: ['scripts/test-editor-stability-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: fs.readFileSync('node_modules/katex/dist/katex.min.css', 'utf8').replace(/url\((fonts\/[^)]+)\)/g,
    (_match, file) => `url(data:font/${path.extname(file).slice(1)};base64,${fs.readFileSync(path.join('node_modules/katex/dist', file)).toString('base64')})`) });
  await page.addStyleTag({ content: ':root{--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:Consolas,monospace;--meo-font-source-size:14px}' });
  // Distinct witness colors change no geometry. Screencast pixels independently
  // check what Chromium actually painted, alongside the passive DOM sampler.
  // This fixture starts at document line 1 and has no collapsed rows before
  // line 21; the native gutter also has its leading hidden width spacer.
  await page.addStyleTag({ content: '#app.meo-paint-observe .cm-content > :nth-child(21 of .cm-line){color:#00ffff!important}#app.meo-paint-observe .cm-lineNumbers > :nth-child(22 of .cm-gutterElement){color:#ff00ff!important}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });

  const cases = [
    { name: 'wide fraction', width: 1437, prefix: '', digits: 141, initialMode: 'live', kind: 'math' },
    { name: 'narrow quoted fraction', width: 950, prefix: '> ', digits: 70, initialMode: 'live', kind: 'math' },
    { name: 'fraction fitting changes', width: 750, prefix: '', digits: 70, initialMode: 'live', kind: 'math' },
    { name: 'math fence shared layout', width: 750, prefix: '', digits: 70, initialMode: 'live', kind: 'math', language: 'math' },
    { name: 'quoted tex fence shared layout at 120%', width: 950, prefix: '> ', digits: 70, initialMode: 'live', kind: 'math', language: 'tex', scale: 1.2 },
    { name: 'plain inline code', width: 950, prefix: '', digits: 141, initialMode: 'live', kind: 'code' },
    { name: 'source inline code', width: 950, prefix: '', digits: 141, initialMode: 'source', kind: 'code' },
    { name: 'recent-save source diff at 120%', width: 950, prefix: '', digits: 141, initialMode: 'source', kind: 'code', baseline: 'recent-save', scale: 1.2 },
    { name: 'agent-before source diff at 150%', width: 520, prefix: '', digits: 70, initialMode: 'live', kind: 'code', baseline: 'fixed', scale: 1.5 }
  ] as const;
  const client = await page.createCDPSession();
  // A held key starts after a pause, then repeats around 30ms. Sending without
  // awaiting each acknowledgement also exercises queued input under rendering load.
  const cadence = [0, 500, 750, 1250, ...Array.from({ length: 20 }, (_, i) => 1280 + i * 30)];
  let totalFrames = 0;
  let paintedFrames = 0;
  const selectedCases = process.argv.includes('--fences-only') ? cases.filter(scenario => 'language' in scenario) : cases;
  for (const scenario of selectedCases) {
    await page.setViewport({ width: scenario.width, height: 805, deviceScaleFactor: 'scale' in scenario ? scenario.scale : 1 });
    await page.evaluate(async scenario => {
      const host = window as any;
      host.ed?.destroy(); document.querySelector('#app')!.replaceChildren();
      const formula = '\\frac{\\frac{a+b' + '1'.repeat(scenario.digits) + '}{c+d}}{\\sqrt{x^2+y^2}} = \\sum_{n=1}^{\\infty}\\frac{1}{n^2}';
      const source = scenario.kind === 'math'
        ? [scenario.prefix + ('language' in scenario ? '```' + scenario.language : '$$'),
          scenario.prefix + formula, scenario.prefix + ('language' in scenario ? '```' : '$$')]
        : ['', '`a' + '1'.repeat(scenario.digits) + '`', ''];
      const text = [...Array.from({ length: 15 }, (_, i) => 'Before ' + i), '', ...source, '', 'AFTER_FORMULA', '', ...Array.from({ length: 80 }, (_, i) => 'Tail ' + i)].join('\n');
      host.ed = host.EditorStabilityHarness.createEditor({ parent: document.querySelector('#app'), text,
        initialMode: scenario.initialMode, sourceLineNumbers: 'on', onApplyChanges() {} });
      if ('baseline' in scenario) {
        host.ed.setGitBaseline({ available: true, tracked: true, mode: scenario.baseline,
          baseText: text.replace(source[1], '`previous code`') });
        host.EditorStabilityHarness.setGitDiffDetailsVisible(host.ed, true);
        host.ed.setMode('source');
      }
      const view = host.ed.view;
      view.dispatch({ selection: { anchor: view.state.doc.line(18).from + (scenario.kind === 'math'
        ? scenario.prefix.length + '\\frac{\\frac{a+b'.length : '`a'.length) + scenario.digits } });
      view.focus(); await document.fonts.ready;
      for (let i = 0; i < 16; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      host.readGutter = () => {
        const line = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line'))
          .find(element => element.textContent === 'AFTER_FORMULA');
        const gutter = Array.from(view.dom.querySelectorAll<HTMLElement>(':scope > .cm-scroller > .cm-gutters > .cm-lineNumbers > .cm-gutterElement'))
          .find(element => element.textContent?.trim() === '21');
        // coordsAtPos calls readMeasured and repairs the transient
        // height map. Only read DOM rectangles while observing an input frame.
        return { length: view.state.doc.line(18).length, content: line?.getBoundingClientRect().top,
          gutter: gutter?.getBoundingClientRect().top };
      };
      host.baseline = host.readGutter(); host.frames = []; host.sampling = true;
      const sample = () => {
        if (!host.sampling) return;
        // Read after this frame's callbacks: a source wrap can legitimately be
        // measured by CodeMirror later in the same frame, before it is painted.
        setTimeout(() => { if (host.sampling) host.frames.push(host.readGutter()); }, 0);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, scenario);
    const images: string[] = [];
    const capturePaint = scenario.name === 'fraction fitting changes' || 'language' in scenario;
    let armed = false;
    let ready!: () => void;
    const paintReady = new Promise<void>(resolve => { ready = resolve; });
    const receiveFrame = async (event: { data: string; sessionId: number }) => {
      void client.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      // The initial screencast can contain the last pre-instrumentation paint.
      // Arm before input, then retain every delivered frame without filtering.
      if (!armed) {
        const rows = await paintedRows(event.data);
        if (rows.contentTop < 0 || rows.gutterTop < 0) return;
        if (armed) return;
        armed = true; ready();
      }
      images.push(event.data);
    };
    if (capturePaint) {
      await page.evaluate(() => {
        const app = document.querySelector('#app')!;
        assertWitness(app.querySelector('.cm-content > :nth-child(21 of .cm-line)')?.textContent === 'AFTER_FORMULA');
        assertWitness(app.querySelector('.cm-lineNumbers > :nth-child(22 of .cm-gutterElement)')?.textContent?.trim() === '21');
        app.classList.add('meo-paint-observe');
        function assertWitness(present: boolean) { if (!present) throw new Error('Paint witness does not match the fixture source row'); }
      });
      client.on('Page.screencastFrame', receiveFrame);
      await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([paintReady, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Paint witnesses did not become visible before input')), 5000);
        })]);
      } finally { clearTimeout(timeout); }
    }
    for (const operation of ['insert', 'delete'] as const) {
      const start = Date.now();
      const pending: Promise<unknown>[] = [];
      const key = operation === 'insert' ? '1' : 'Backspace';
      const code = operation === 'insert' ? 'Digit1' : 'Backspace';
      const keyCode = operation === 'insert' ? 49 : 8;
      for (const [index, offset] of cadence.entries()) {
        const delay = offset - (Date.now() - start);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        pending.push(client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code,
          ...(operation === 'insert' ? { text: '1', unmodifiedText: '1' } : {}),
          windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, autoRepeat: index > 0 }));
      }
      await Promise.all(pending);
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code,
        windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
      const length = await page.evaluate(() => (window as any).readGutter().length);
      const baselineLength = await page.evaluate(() => (window as any).baseline.length);
      assert.equal(length - baselineLength, operation === 'insert' ? cadence.length : 0,
        `${scenario.name}: ${operation} did not reach the source`);
    }
    // Browser composition events cover preedit/commit without pretending to
    // test the Windows candidate window. Keep this under the same frame sampler.
    await client.send('Input.imeSetComposition', { text: 'zh', selectionStart: 2, selectionEnd: 2 });
    await new Promise(resolve => setTimeout(resolve, 60));
    await client.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
    await new Promise(resolve => setTimeout(resolve, 60));
    await client.send('Input.insertText', { text: '中文' });
    assert.equal(await page.evaluate(() => (window as any).readGutter().length),
      await page.evaluate(() => (window as any).baseline.length + 2), `${scenario.name}: composition not committed once`);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    const result = await page.evaluate(() => {
      const host = window as any; host.sampling = false;
      const baseline = host.baseline;
      return { baseline, final: host.readGutter(), count: host.frames.length,
        failures: host.frames.filter((frame: any) => !Number.isFinite(frame.content) || !Number.isFinite(frame.gutter)
          || Math.abs((frame.gutter - frame.content) - (baseline.gutter - baseline.content)) > 1).slice(0, 5) };
    });
    assert.ok(Number.isFinite(result.baseline.content) && Number.isFinite(result.baseline.gutter), scenario.name + ': missing observed paragraph');
    assert.equal(result.final.length, result.baseline.length, scenario.name + ': deletion did not restore source length');
    assert.ok(result.count > 30, scenario.name + ': missing intermediate frames');
    assert.deepEqual(result.failures, [], scenario.name + ': line numbers drift while the paragraph stays in place');
    if (capturePaint) {
      await client.send('Page.stopScreencast');
      client.off('Page.screencastFrame', receiveFrame);
      await page.evaluate(() => document.querySelector('#app')!.classList.remove('meo-paint-observe'));
      const offsets: number[] = [];
      for (const encoded of images) {
        const { contentTop, gutterTop } = await paintedRows(encoded);
        if (contentTop < 0 || gutterTop < 0) {
          fs.mkdirSync('.local/line-number-diagnosis', { recursive: true });
          fs.writeFileSync('.local/line-number-diagnosis/gutter-pixel-failure.png', Buffer.from(encoded, 'base64'));
        }
        assert.ok(contentTop >= 0 && gutterTop >= 0, 'A painted frame lost a content/gutter witness: ' +
          JSON.stringify({ frame: offsets.length, contentTop, gutterTop, baseline: result.baseline, final: result.final }));
        offsets.push(gutterTop - contentTop);
      }
      assert.ok(offsets.length >= 6, 'Missing actual painted input frames');
      assert.ok(offsets.every(offset => Math.abs(offset - offsets[0]!) <= 1),
        'Actual painted gutter drift: ' + JSON.stringify(offsets));
      paintedFrames += offsets.length;
    }
    totalFrames += result.count;
  }
  assert.deepEqual(errors, []);
  console.log(`Gutter paint stability passed: ${selectedCases.length} typing scenarios, ${totalFrames} passive input frames, ${paintedFrames} screencast pixel checks`);
} catch (error) { primary = error; } finally {
  if (primary === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primary);
}
