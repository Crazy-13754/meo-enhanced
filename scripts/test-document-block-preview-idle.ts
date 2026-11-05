import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchTestBrowser } from './browser-test-helpers';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-block-preview-idle-'));
const build = await Bun.build({ entrypoints: ['scripts/test-document-block-preview-idle-entry.ts'],
  outdir: temp, target: 'browser', format: 'iife', naming: 'entry.js' });
assert(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setContent('<!doctype html><iframe style="width:900px;height:600px"></iframe>');
  await page.addScriptTag({ path: path.join(temp, 'entry.js') });
  for (const count of [4, 512]) {
    const result = await page.evaluate(async count => {
      const doc = document.querySelector('iframe')!.contentDocument!;
      doc.body.innerHTML = '<style>pre{height:24px}body{color:#111;background:#fff}</style>'
        + '<div class="meo-export-code-block-wrap" data-source-line="1"><pre><code class="language-fixture">graph source</code></pre></div>'
        + '<pre><code class="language-text">ordinary source</code></pre>'.repeat(count);
      let scans = 0;
      const query = doc.querySelectorAll.bind(doc);
      doc.querySelectorAll = ((selector: string) => {
        if (selector === 'pre > code') scans++;
        return query(selector);
      }) as typeof doc.querySelectorAll;
      const blocks = (window as any).createDocumentBlocks({ getState: () => null, saveState() {}, getLanguage: () => 'en',
        renderContent: async () => ({ html: '' }) });
      const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
      const mutate = async () => { doc.body.append(doc.createElement('span')); await settle(); };
      try {
        blocks.refreshPreview(doc);
        await mutate(); await mutate();
        const absentScans = scans;
        scans = 0;
        blocks.setViews([{ id: 'panel', label: 'Panel', entryUri: 'data:text/javascript,invalid' }]);
        await mutate();
        const panelScans = scans;
        scans = 0;
        const descriptor = { id: 'fixture', label: 'Fixture', codeBlockLanguages: ['fixture'], entryUri: 'data:text/javascript,'
          + encodeURIComponent('export const apiVersion=1;export function createSvgRenderer(){return {async render(){return \'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="5" y="30">Rendered graph</text></svg>\'},dispose(){}}}') };
        blocks.setViews([descriptor]);
        for (let i = 0; i < 60 && !doc.querySelector('.meo-contributed-block')?.shadowRoot?.querySelector('svg text'); i++) await settle();
        const mounted = doc.querySelector('.meo-contributed-block');
        const active = !!mounted?.shadowRoot?.querySelector('svg text');
        const activeScans = scans;
        await mutate();
        const retained = doc.querySelector('.meo-contributed-block') === mounted;
        blocks.setViews([]);
        await settle(); scans = 0;
        await mutate(); await mutate();
        const disabledScans = scans;
        const restored = !doc.querySelector('.meo-contributed-block') && doc.querySelector('pre')!.style.display === '';
        blocks.setViews([descriptor]); await settle();
        const reenabled = !!doc.querySelector('.meo-contributed-block');
        return { absentScans, panelScans, active, activeScans, retained, disabledScans, restored, reenabled };
      } finally { blocks.dispose(); doc.querySelectorAll = query; }
    }, count);
    console.log(JSON.stringify({ count, ...result }));
    assert.equal(result.absentScans, 0, 'No code renderer: preview mutations must not rescan every code block');
    assert.equal(result.panelScans, 0, 'Panel-only contributions do not consume preview code blocks');
    assert(result.active && result.activeScans > 0 && result.retained, 'A registered renderer mounts and retains its graph');
    assert.equal(result.disabledScans, 0, 'Disabling renderers releases the preview observer');
    assert(result.restored && result.reenabled, 'Disable restores source; re-enable mounts existing preview content');
  }
  assert.deepEqual(errors, []);
  console.log('Document block preview idle work and renderer lifecycle passed');
} finally {
  await browser.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
