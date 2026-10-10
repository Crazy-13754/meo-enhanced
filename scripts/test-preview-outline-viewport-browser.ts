import assert from 'node:assert/strict';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';

const build = await Bun.build({ entrypoints: ['scripts/test-preview-reading-surface-production-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const bundle = await build.outputs[0]!.text();
const text = Array.from({ length: 40 }, (_, index) => `## Section ${index}\n\n${'Reading paragraph. '.repeat(50)}\n`).join('\n');
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 760 });
  // VS Code can create a webview while its editor tab has no layout boxes.
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><style id="hidden-preview">.preview-host{display:none!important}</style><div id="app"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.exposeFunction('__render', (message: any) => message.type === 'requestPreviewRender' ? {
    type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: exportRuntime.renderPreviewDocument({
      markdownText: message.text, sourceDocumentPath: 'C:/tmp/outline.md', uiLanguage: 'en', styleEnvironment: message.environment, preset: message.preset
    }) }
  } : null);
  await page.addScriptTag({ content: `window.acquireVsCodeApi=()=>({getState(){return {}},setState(){},postMessage(message){window.__render(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent('message',{data:response}));});}});` });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(text => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'init', documentId: 'file:///outline.md', text, version: 1, savedRevision: { version: 1, text },
    diagnostics: [], mode: 'preview', uiLanguage: 'en', sourceLineNumbers: 'on', previewAppearance: 'dark',
    previewFontFamily: 'Arial', previewSourceColoring: false, previewShowComments: false, editorAppearance: 'dark',
    gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit',
    fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
    findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: true, outlineWidth: 260, vscodeTheme: null
  } })), text);
  await page.waitForFunction(() => document.querySelectorAll('.outline-item').length === 40);
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.evaluate(() => { document.querySelector('#hidden-preview')!.remove(); });
  await new Promise(resolve => setTimeout(resolve, 500));
  const read = () => page.evaluate(() => ({
    total: document.querySelectorAll('.outline-item').length,
    visible: document.querySelectorAll('.outline-item.is-visible').length,
    height: document.querySelector('.outline-visible-range')?.getBoundingClientRect().height ?? 0
  }));
  const initial = await read();
  assert.ok(initial.visible > 0 && initial.visible < 6 && initial.height < 150, `Outline must recover the viewport after a hidden tab becomes visible: ${JSON.stringify(initial)}`);
  await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('h2[data-source-line="61"]')!.scrollIntoView());
  await new Promise(resolve => setTimeout(resolve, 100));
  const scrolled = await read();
  assert.ok(scrolled.visible > 0 && scrolled.visible < 6 && scrolled.height < 150, JSON.stringify(scrolled));
  console.log('Preview outline viewport and hidden-tab recovery passed.');
} finally {
  await browser.close();
}
