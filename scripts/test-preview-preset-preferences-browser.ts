import assert from 'node:assert/strict';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';
import { getPreviewPreset } from '../src/foundation/previewPresets';
import { createPreviewPresetPreferences } from '../src/host/previewPresetPreferences';
import { createCustomPreviewPreset, parseCustomPreviewPresetManifest } from '../src/foundation/customPreviewPreset';

const build = await Bun.build({ entrypoints: ['scripts/test-preview-reading-surface-production-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const bundle = await build.outputs[0]!.text();
const text = '# Preset memory\n\n```typescript\nconst value = 42;\n```\n\n<!-- memory comment -->';
let selected: string | undefined;
let preferences: Record<string, any> | undefined;
const custom = createCustomPreviewPreset(parseCustomPreviewPresetManifest({ schemaVersion: 1, id: 'memory', name: 'Memory', description: 'Memory fixture', base: 'default', controls: { fontFamily: { mode: 'editable' } }, themes: { light: { css: 'light.css' }, dark: { css: 'dark.css' } } }), { light: ':root { --meo-bg: #fafafa; }', dark: ':root { --meo-bg: #222222; }' }, 'a'.repeat(64));
const createOwner = () => createPreviewPresetPreferences({ readStored: () => preferences, writeStored: async value => { preferences = structuredClone(value); }, getPreset: id => id === custom.id ? custom : getPreviewPreset(id) });
let owner = createOwner();
const defaults = { previewAppearance: 'auto', previewFontFamily: 'Georgia', previewSourceColoring: true, previewShowComments: false };
const browser = await launchTestBrowser();
try {
  const open = async (state: unknown = {}, editorAppearance = 'dark') => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 760 });
    await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.exposeFunction('__sendHostMessage', async (message: any) => {
      if (message.type === 'setPreviewPreset') selected = message.preset;
      if (message.type === 'setPreviewPresetPreference') {
        await owner.update(message.preset, message.preference, message.initialPreference, message.onlyIfMissing);
      }
      if (message.type === 'requestPreviewRender') return {
        type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: exportRuntime.renderPreviewDocument({
          markdownText: message.text, sourceDocumentPath: 'C:/notes/memory.md', uiLanguage: message.uiLanguage,
          styleEnvironment: message.environment, preset: message.preset, contentWidth: message.contentWidth,
          presetDefinition: message.preset === custom.id ? custom : undefined
        }) }
      };
      return null;
    });
    await page.addScriptTag({ content: `
      window.__presetState=${JSON.stringify(state)};window.__presetMessages=[];window.__pendingHostMessages=0;
      window.acquireVsCodeApi=()=>({getState(){return window.__presetState},setState(state){window.__presetState=state},postMessage(message){
        window.__presetMessages.push(message);window.__pendingHostMessages++;
        window.__sendHostMessage(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent('message',{data:response}));}).finally(()=>window.__pendingHostMessages--);
      }});
    ` });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(init => window.dispatchEvent(new MessageEvent('message', { data: init })), {
      type: 'init', documentId: 'file:///preset-memory.md', text, version: 1, savedRevision: { version: 1, text },
      diagnostics: [], mode: 'preview', uiLanguage: 'en', sourceLineNumbers: 'on', ...defaults, editorAppearance,
      previewPreset: selected, previewPresetPreferences: await owner.read(),
      customPreviewPresets: [custom],
      gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit',
      fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
      findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260, vscodeTheme: null
    });
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.body.textContent?.includes('Preset memory'));
    return page;
  };
  type Page = Awaited<ReturnType<typeof open>>;
  const settle = (page: Page) => page.waitForFunction(() => (window as any).__pendingHostMessages === 0);
  const select = async (page: Page, preset: string) => {
    await page.select('.preview-preset-control select', preset);
    try {
      await page.waitForFunction(preset => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.documentElement.dataset.meoPreviewPreset === preset, {}, preset);
    } catch (error) { throw new Error(`Failed to present preset ${preset}`, { cause: error }); }
    await settle(page);
  };
  const controls = (page: Page) => page.evaluate(() => ({
    appearance: document.querySelector<HTMLSelectElement>('.preview-appearance-select')!.value,
    fontFamily: document.querySelector<HTMLSelectElement>('.preview-font-family-control select')!.value,
    sourceColoring: document.querySelector<HTMLSelectElement>('.preview-source-coloring-select')!.value === 'true',
    showComments: document.querySelector('[data-preview-comments="true"]')!.getAttribute('aria-pressed') === 'true'
  }));
  const booleans = async (page: Page, sourceColoring: boolean, showComments: boolean) => {
    if (await page.$eval('.preview-options-panel', element => (element as HTMLElement).hidden)) await page.click('.preview-options-trigger');
    await page.click(`[data-preview-source-coloring="${sourceColoring}"]`);
    await page.click(`[data-preview-comments="${showComments}"]`);
    await settle(page);
  };
  const waitWhitey = (page: Page, appearance: 'light' | 'dark') => page.waitForFunction(appearance => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
    const root = doc?.querySelector('.meo-export-doc');
    return root && doc!.defaultView!.getComputedStyle(root).backgroundColor === (appearance === 'dark' ? 'rgb(30, 34, 42)' : 'rgb(254, 254, 254)');
  }, {}, appearance);
  const page = await open();
  for (const id of ['default', 'github-readme', 'newsprint', 'obsidian-minimal', custom.id, 'whitey']) {
    await select(page, id);
    assert.equal((await controls(page)).appearance, id === 'newsprint' ? 'light' : 'auto', `${id} derives its initial appearance from theme support`);
  }
  await waitWhitey(page, 'dark');
  const staleState = await page.evaluate(() => (window as any).__presetState);
  await page.click('[data-preview-appearance-choice="dark"]');
  await page.select('.preview-font-family-control select', 'Arial');
  await booleans(page, false, true);
  const whitey = { appearance: 'dark', fontFamily: 'Arial', sourceColoring: false, showComments: true };
  assert.deepEqual(await controls(page), whitey);
  await page.waitForFunction(() => !!document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-comment'));
  await select(page, 'obsidian-minimal');
  await page.select('.preview-font-family-control select', 'Georgia');
  await page.click('[data-preview-appearance-choice="light"]');
  await booleans(page, true, false);
  await select(page, custom.id);
  await page.select('.preview-font-family-control select', 'Arial');
  await page.click('[data-preview-appearance-choice="light"]');
  await booleans(page, false, true);
  await select(page, 'default');
  assert.deepEqual(await controls(page), { appearance: 'auto', fontFamily: 'Georgia', sourceColoring: true, showComments: false }, 'Preset edits leave Default settings intact');
  await select(page, 'obsidian-minimal');
  assert.deepEqual(await controls(page), { appearance: 'light', fontFamily: 'Georgia', sourceColoring: true, showComments: false });
  await select(page, 'newsprint');
  await page.select('.preview-font-family-control select', 'Arial');
  await booleans(page, false, true);
  await select(page, 'github-readme');
  await page.click('[data-preview-appearance-choice="light"]');
  await settle(page);
  await select(page, 'whitey');
  assert.deepEqual(await controls(page), whitey, 'Every editable setting survives switching away and back');
  assert.equal(await page.evaluate(() => (window as any).__presetMessages.some((message: any) => ['setPreviewFontFamily', 'setPreviewSourceColoring', 'setPreviewShowComments', 'setPreviewAppearance'].includes(message.type))), false, 'Non-default edits never write Default settings');
  await page.close();
  owner = createOwner();
  const reopened = await open();
  assert.equal(await reopened.$eval('.preview-appearance-select', el => (el as HTMLSelectElement).value), 'dark',
    'Whitey appearance survives closing the file and opening another document without its Webview cache');
  assert.equal(await reopened.$eval('.preview-font-family-control select', el => (el as HTMLSelectElement).value), 'Arial');
  assert.equal(await reopened.$eval('.preview-source-coloring-select', el => (el as HTMLSelectElement).value), 'false');
  assert.deepEqual(await controls(reopened), whitey);
  await select(reopened, custom.id);
  assert.deepEqual(await controls(reopened), { ...whitey, appearance: 'light' }, 'Custom preset settings also survive a new document');
  await select(reopened, 'obsidian-minimal');
  assert.deepEqual(await controls(reopened), { appearance: 'light', fontFamily: 'Georgia', sourceColoring: true, showComments: false });
  await select(reopened, 'newsprint');
  assert.deepEqual(await controls(reopened), { ...whitey, appearance: 'light' }, 'Single-theme preset font and switches survive a new document');
  await select(reopened, 'github-readme');
  assert.equal((await controls(reopened)).appearance, 'light', 'GitHub retains its selected appearance across documents');
  await select(reopened, 'whitey');
  await reopened.close();
  const stale = await open(staleState);
  assert.deepEqual(await controls(stale), whitey, 'Host preferences take precedence over stale per-document caches');
  await stale.close();
  const corrupt = await open({ previewPresetState: { preset: 'invalid', preferences: { unknown: { appearance: 'dark', contentWidth: 'responsive' } } } });
  assert.deepEqual(await controls(corrupt), whitey, 'Invalid legacy cache cannot suppress valid Host preferences');
  await corrupt.close();
  const light = await open({}, 'light');
  await light.click('[data-preview-appearance-choice="auto"]');
  await settle(light);
  await waitWhitey(light, 'light');
  await light.close();
  const dark = await open();
  assert.equal((await controls(dark)).appearance, 'auto', 'Saved Auto remains Auto in a new document');
  await waitWhitey(dark, 'dark');
  await dark.close();
  preferences = undefined;
  selected = undefined;
  owner = createOwner();
  const legacy = await open({ previewPresetState: { preset: 'whitey', preferences: { whitey: { appearance: 'dark', contentWidth: 'responsive', fontFamily: 'Arial' } } } });
  await settle(legacy);
  assert.equal((await controls(legacy)).appearance, 'dark');
  await legacy.close();
  const migrated = await open();
  assert.equal((await controls(migrated)).fontFamily, 'Arial', 'Legacy per-document preferences migrate once to Host storage');
  await migrated.close();
  const otherLegacy = await open({ previewPresetState: { preset: 'obsidian-minimal', preferences: { 'obsidian-minimal': { appearance: 'light', contentWidth: 'responsive', fontFamily: 'Georgia' } } } });
  await settle(otherLegacy);
  await otherLegacy.close();
  defaults.previewSourceColoring = false;
  defaults.previewShowComments = true;
  const otherMigrated = await open();
  await select(otherMigrated, 'obsidian-minimal');
  assert.equal((await controls(otherMigrated)).fontFamily, 'Georgia', 'Legacy migration fills missing presets even when Host remembers another preset');
  assert.deepEqual(await controls(otherMigrated), { appearance: 'light', fontFamily: 'Georgia', sourceColoring: true, showComments: false }, 'Legacy migration snapshots shared switches before later Default changes');
  await otherMigrated.close();
  console.log('Preview preset preferences: built-in/custom defaults, switches, new documents, stale caches, Auto and legacy migration passed.');
} finally {
  await browser.close();
}
