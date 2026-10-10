import assert from 'node:assert/strict';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';

const build = await Bun.build({ entrypoints: ['scripts/test-preview-reading-surface-production-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const bundle = await build.outputs[0]!.text();
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1200, height: 760 });
  await page.setContent('<!doctype html><style id="host-theme">:root{--vscode-editor-font-family:monospace;--vscode-editor-font-size:14px}html,body,#app{height:100%;margin:0}</style><body class="vscode-dark"><div id="app"></div></body>');
  // Real VS Code injects theme variables inline; stylesheet-only fixtures miss
  // accidental removal of the native background during appearance setup.
  await page.evaluate(() => document.documentElement.style.setProperty('--vscode-editor-background', '#1b2430'));
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.exposeFunction('__renderBackgroundPreview', (message: any) => {
    if (message.type !== 'requestPreviewRender') return null;
    return { type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: exportRuntime.renderPreviewDocument({
      markdownText: message.text, sourceDocumentPath: 'C:/tmp/background.md', uiLanguage: message.uiLanguage,
      styleEnvironment: message.environment, preset: message.preset, contentWidth: message.contentWidth
    }) } };
  });
  await page.addScriptTag({ content: 'window.acquireVsCodeApi=()=>({getState(){return {}},setState(){},postMessage(message){window.__renderBackgroundPreview(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent("message",{data:response}));});}});' });
  await page.addScriptTag({ content: bundle });
  const text = '# Theme background\n\nLive / Source / Default Preview\n\n- Native editor background\n- Light and dark themes\n\n> Theme colors follow the editor.\n\n' + 'Reading paragraph.\n\n'.repeat(35);
  await page.evaluate(init => window.dispatchEvent(new MessageEvent('message', { data: init })), {
    type: 'init', documentId: 'file:///background.md', text, version: 1, savedRevision: { version: 1, text },
    diagnostics: [], mode: 'preview', uiLanguage: 'en', sourceLineNumbers: 'on', previewAppearance: 'auto',
    previewFontFamily: '', previewSourceColoring: false, previewShowComments: false, editorAppearance: 'auto',
    gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit',
    fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
    findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260,
    vscodeTheme: { name: 'Native dark', type: 'dark', colors: {}, tokenColors: [] }
  });
  const waitBackground = async (expected: string) => {
    await page.waitForFunction(expected => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
      return getComputedStyle(document.body).backgroundColor === expected
        && doc?.body && doc.defaultView!.getComputedStyle(doc.body).backgroundColor === expected;
    }, { timeout: 4000 }, expected);
  };
  const checkModes = async (expected: string, selectedBackground: number[], toolbarBackground: string) => {
    await waitBackground(expected);
    for (const mode of ['live', 'source', 'preview']) {
      await page.click(`button[data-mode="${mode}"]`);
      await page.waitForFunction(mode => document.querySelector<HTMLElement>('.editor-root')?.dataset.mode === mode, {}, mode);
      assert.equal(await page.$eval('body', element => getComputedStyle(element).backgroundColor), expected);
      if (mode !== 'preview') assert.equal(await page.$eval('.cm-editor', element => getComputedStyle(element).backgroundColor), expected);
    }
    await waitBackground(expected);
    const indicator = await page.$eval('.segmented-control-button.is-active .segmented-control-button-indicator', element => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    const toolbar = await page.$eval('.mode-toolbar', element => getComputedStyle(element).backgroundColor);
    assert.equal(toolbar, toolbarBackground, 'The toolbar must retain its fixed appearance palette');
    assert.deepEqual(indicator, selectedBackground, 'The selected segment must retain its native UI contrast independently of the document background');
  };
  const changeHost = async (appearance: 'light' | 'dark', background: string) => {
    await page.evaluate(({ appearance, background }) => {
      document.body.className = `vscode-${appearance}`;
      document.documentElement.style.setProperty('--vscode-editor-background', background);
      document.getElementById('host-theme')!.textContent = `:root{--vscode-editor-font-family:monospace;--vscode-editor-font-size:14px}html,body,#app{height:100%;margin:0}`;
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'vscodeCodeThemeChanged', appearance, vscodeTheme: { name: 'Native ' + background, type: appearance, colors: {}, tokenColors: [] } } }));
    }, { appearance, background });
  };
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vscode-editor-background')), '#1b2430', 'Theme initialization must preserve the native inline background variable');
  await checkModes('rgb(27, 36, 48)', [42, 47, 51], 'rgb(31, 36, 40)');
  await changeHost('dark', '#242138');
  await checkModes('rgb(36, 33, 56)', [42, 47, 51], 'rgb(31, 36, 40)');
  await changeHost('light', '#f8f1e5');
  await checkModes('rgb(248, 241, 229)', [255, 255, 255], 'rgb(246, 248, 250)');
  await page.click('.more-tools-wrapper > .format-button');
  await page.click('.editor-appearance-button[data-editor-appearance="dark"]');
  await waitBackground('rgb(36, 41, 46)');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vscode-editor-background')), '#f8f1e5', 'Manual appearance must leave the native root color intact');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--meo-content-editor-background').trim()), '#24292e', 'Manual appearance retains its own fallback without overwriting native variables');
  await page.click('.editor-appearance-button[data-editor-appearance="auto"]');
  await waitBackground('rgb(248, 241, 229)');
  await page.click('.more-tools-wrapper > .format-button');
  await page.click('.preview-preset-dropdown');
  await page.click('.preview-preset-dropdown-panel [data-value="github-readme"]');
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
    return doc?.documentElement.dataset.meoPreviewPreset === 'github-readme'
      && doc.defaultView!.getComputedStyle(doc.body).backgroundColor === 'rgb(255, 255, 255)';
  });
  assert.equal(await page.$eval('body', element => getComputedStyle(element).backgroundColor), 'rgb(248, 241, 229)');
  assert.deepEqual(errors, []);
  console.log('Editor background theme checks passed: native inline variables, selected segments, Live/Source/Default Preview, theme transitions and manual appearance.');
} finally {
  await browser.close();
}
