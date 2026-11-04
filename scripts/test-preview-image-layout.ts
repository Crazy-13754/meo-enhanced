import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';
import { previewPresets } from '../src/foundation/previewPresets';
import { createPreviewPresetLibrary, type StoredPreviewPreset } from '../src/host/customPreviewPresets';

const build = await Bun.build({ entrypoints: ['scripts/test-preview-code-update-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const bundle = await build.outputs[0]!.text();
const directory = 'preview-presets/examples/github-readme';
const storage = new Map<string, StoredPreviewPreset>();
const library = createPreviewPresetLibrary({
  list: async () => [...storage.keys()], read: async id => storage.get(id)!,
  write: async (id, value) => { storage.set(id, value); }, remove: async id => { storage.delete(id); }
});
const example = await library.import(readFileSync(path.join(directory, 'preset.jsonc'), 'utf8'),
  async file => readFileSync(path.join(directory, file), 'utf8'));
const presets = [...previewPresets, example];
const wideSvg = readFileSync('scripts/fixtures/github-readme/wide.svg', 'utf8');
let release = () => {};
let held = Promise.resolve();
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  await held;
  return new Response(new URL(request.url).pathname === '/wide.svg' ? wideSvg
    : '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/>',
    { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
} });
const browser = await launchTestBrowser();
let caseNumber = 0;
try {
  for (const preset of presets) for (const appearance of ['light', 'dark'] as const)
    for (const [viewportWidth, layout] of [[1100, 'full'], [600, 'side']] as const) {
      const label = `${preset.id}/${appearance}/${layout}`;
      held = new Promise<void>(resolve => { release = resolve; });
      const page = await browser.newPage();
      await page.setViewport({ width: viewportWidth, height: 900 });
      await page.setContent('<!doctype html><style>html,body{height:100%;margin:0}</style><body></body>');
      await page.addStyleTag({ path: 'webview/src/styles.css' });
      await page.addStyleTag({ content: '.preview-host:not([hidden]){height:100%;display:flex;flex-direction:column}.preview-frame{width:100%;height:100%;flex:1}' });
      const src = new URL(`/held.svg?case=${caseNumber}`, server.url).href;
      const wideSrc = new URL(`/wide.svg?case=${caseNumber++}`, server.url).href;
      await page.evaluate(({ src, wideSrc }) => {
        (window as any).__previewImageSizes = { [src]: { width: 640, height: 360 }, [wideSrc]: { width: 2400, height: 1200 } };
      }, { src, wideSrc });
      await page.addScriptTag({ content: bundle });
      await page.evaluate(({ preset, example, appearance }) => {
        const scope = window as any;
        scope.__initializeImageHandling({ postMessage(message: any) {
          if (message.type === 'resolveImageSrc') queueMicrotask(() => scope.__settleImageSrcRequest({
            type: 'resolvedImageSrc', requestId: message.requestId, result: { ok: true, value: { resolvedUrl: message.url } }
          }));
        } });
        scope.__previewController.updateCustomPresets([example], undefined, true);
        scope.__previewController.setPreset(preset, { render: false });
        scope.__previewController.setAppearance(appearance, { post: true });
      }, { preset: preset.id, example, appearance });
      const text = `Before\n\n![plain](${src})\n\nAfter image target`
        + `\n\n![wide](${wideSrc})\n\n[![linked-wide](${wideSrc})](https://example.com/)`
        + `\n\n<img src="${wideSrc}" width="2400" height="1200" alt="authored-wide">`
        + `\n\n<img src="${src}" width="120" height="80" alt="authored">`;
      const value = exportRuntime.renderPreviewDocument({ markdownText: text, sourceDocumentPath: '/fixture/images.md',
        uiLanguage: 'en', preset: preset.id, presetDefinition: preset, layout });
      await page.evaluate(({ text, value, layout }) => {
        const scope = window as any, controller = scope.__previewController;
        controller.setVisible(true);
        scope.__render = controller.requestRender(text, { force: true, layout });
        const message = scope.__previewMessages.findLast((message: any) => message.type === 'requestPreviewRender');
        controller.acceptRenderResponse({ type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value } });
      }, { text, value, layout });
      await page.waitForFunction(() => {
        const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
        return doc?.querySelector<HTMLImageElement>('img[alt="wide"]')?.getAttribute('width') === '2400'
          && doc.querySelector<HTMLImageElement>('img[alt="authored"]')?.style.aspectRatio === '640 / 360';
      });
      const snapshot = () => page.evaluate(() => {
        const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
        return {
          appearance: document.querySelector<HTMLElement>('.preview-host')!.style.colorScheme,
          background: doc.defaultView!.getComputedStyle(doc.body).backgroundColor,
          lineTop: [...doc.querySelectorAll('p')].find(node => node.textContent === 'After image target')!.getBoundingClientRect().top,
          images: [...doc.querySelectorAll('img')].map(image => {
            const rect = image.getBoundingClientRect();
            return { alt: image.alt, width: rect.width, height: rect.height, naturalWidth: image.naturalWidth,
              widthAttribute: image.getAttribute('width'), heightAttribute: image.getAttribute('height') };
          })
        };
      });
      const before = await snapshot();
      const expectedAppearance = preset.controls.appearance.options?.includes(appearance) ? appearance : 'light';
      assert.equal(before.appearance, expectedAppearance, `${label}: use the resolved preset theme`);
      if (preset.id === 'github-readme' || preset.custom?.base === 'github-readme') {
        assert.equal(before.background, appearance === 'light' ? 'rgb(255, 255, 255)' : 'rgb(13, 17, 23)',
          `${label}: apply the requested GitHub theme to the frame`);
      }
      assert.equal(before.images.length, 5, label);
      for (const image of before.images) {
        assert.equal(image.naturalWidth, 1, `${label}/${image.alt}: decoding must still be held`);
        assert.ok(image.width > 0 && image.height > 0, `${label}/${image.alt}: reserve geometry before decoding`);
        const ratio = image.alt.includes('wide') ? 2 : 640 / 360;
        assert.ok(Math.abs(image.height - image.width / ratio) <= 1,
          `${label}/${image.alt}: preserve aspect ratio before decoding: ${JSON.stringify(image)}`);
      }
      const authored = before.images.find(image => image.alt === 'authored')!;
      assert.equal(authored.width, 120, label);
      assert.equal(authored.height, 67.5, `${label}: height:auto preserves the natural ratio with authored width`);
      assert.equal(authored.widthAttribute, '120');
      assert.equal(authored.heightAttribute, '80');
      assert.ok(before.images.find(image => image.alt === 'wide')!.width < 2400, `${label}: exercise container-constrained scaling`);
      release();
      // Deferred resources load on viewport demand, including images farther down the page.
      for (const { alt } of before.images) {
        await page.evaluate(alt => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
          .querySelector<HTMLImageElement>(`img[alt="${alt}"]`)!.scrollIntoView(), alt);
        await page.waitForFunction(alt => {
          const image = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
            .querySelector<HTMLImageElement>(`img[alt="${alt}"]`)!;
          return image.naturalWidth === (alt.includes('wide') ? 2400 : 640) && image.dataset.meoPreviewImageReady === 'true';
        }, {}, alt);
      }
      await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentWindow!.scrollTo(0, 0));
      const after = await snapshot();
      assert.ok(Math.abs(before.lineTop - after.lineTop) <= 1, `${label}: decoding moved following text`);
      for (const [index, image] of after.images.entries()) {
        for (const key of ['width', 'height'] as const) assert.ok(Math.abs(before.images[index]![key] - image[key]) <= 1,
          `${label}/${image.alt}: decoding moved ${key}: ${JSON.stringify({ before: before.images[index], after: image })}`);
        const ratio = image.alt.includes('wide') ? 2 : 640 / 360;
        assert.ok(Math.abs(image.height - image.width / ratio) <= 1, `${label}/${image.alt}: preserve ratio after decoding`);
        assert.equal(image.widthAttribute, before.images[index]!.widthAttribute);
        assert.equal(image.heightAttribute, before.images[index]!.heightAttribute);
      }
      await page.evaluate(() => (window as any).__previewController.dispose());
      await page.close();
    }
  console.log(`Preview image ratios, reserved geometry and authored dimensions passed: ${caseNumber} preset/theme/layout cases`);
} finally {
  release();
  server.stop(true);
  await browser.close();
}
