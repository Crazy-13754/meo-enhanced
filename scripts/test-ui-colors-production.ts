import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';
import { createAppearanceSettingsOwner, type AppearanceSettingsStore } from '../src/host/appearanceSettings';
import { decodeWebviewToHostMessage } from '../src/protocol/messages';
import type { UpdateUiColorsRequest, UiColorsResult } from '../src/protocol/uiColors';

const build = await Bun.build({ entrypoints: ['scripts/test-settings-window-production-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const configuration = new Map<string, unknown>();
let fail = false;
const store: AppearanceSettingsStore = {
  readConfiguration: key => ({ value: configuration.get(key), explicit: configuration.has(key), globalValue: configuration.get(key) }),
  updateConfiguration: async (key, value) => { if (fail) throw new Error('fixture write failure'); configuration.set(key, value); },
  readLegacy: () => undefined, updateLegacy: async () => {}
};
const owner = await createAppearanceSettingsOwner(store);
const browser = await launchTestBrowser(); const page = await browser.newPage();
const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
try {
  await page.exposeFunction('__saveColors', async (input: UpdateUiColorsRequest): Promise<UiColorsResult> => {
    const request = decodeWebviewToHostMessage(input);
    assert.equal(request?.type, 'updateUiColors');
    try { return { type: 'uiColorsResult', requestId: input.requestId, result: { ok: true, value: await owner.setUiColors(input.colors) } }; }
    catch (error) { return { type: 'uiColorsResult', requestId: input.requestId, result: { ok: false, error: { code: 'operation-failed', message: String(error) } } }; }
  });
  const openFixture = async () => {
    await page.setViewport({ width: 1100, height: 820 });
    await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><body class="vscode-dark"><div id="app"></div></body>');
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.addStyleTag({ content: ':root{--vscode-editor-background:#22272e;--vscode-editorWidget-background:#22272e;--vscode-foreground:#e5e5e5;--vscode-editor-foreground:#ddd;--vscode-textLink-foreground:#79b8ff;--vscode-button-background:#2472c8;--vscode-font-family:Arial;--vscode-editor-font-family:monospace;--vscode-editor-font-size:14px}' });
    await page.addScriptTag({ content: `
      window.__messages=[];
      window.acquireVsCodeApi=()=>({getState(){},setState(){},postMessage(message){
        window.__messages.push(message);
        if(message.type==='updateUiColors') {
          window.__saveColors(message).then(response=>{
            const reply=()=>{ if(response.result.ok) window.dispatchEvent(new MessageEvent('message',{data:{type:'uiColorsChanged',colors:response.result.value}})); window.dispatchEvent(new MessageEvent('message',{data:response})); };
            if(window.__holdColorsReply) {window.__holdColorsReply=false;window.__releaseColorsReply=reply;} else reply();
          });
        }
      }});
    ` });
    await page.addScriptTag({ content: await build.outputs[0].text() });
    await page.evaluate(colors => {
      const global = window as any; const text = '# Heading\n\nbody text\n\n- List item';
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'init', documentId: 'file:///colors.md', text, version: 1, savedRevision: { version: 1, text }, diagnostics: [], mode: 'source', uiLanguage: 'zh-CN', sourceLineNumbers: 'on', previewAppearance: 'light', previewFontFamily: '', previewSourceColoring: true, editorAppearance: 'auto', uiColors: colors, gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260, vscodeTheme: {name: 'fixture', type: 'dark', colors: {}, tokenColors: []}, editingPreferences: {input: {...global.EditingSettingsHarness.defaultInputAssistance},shortcuts:{}} } }));
    }, owner.getUiColors());
    await page.waitForFunction(() => !document.querySelector('.mode-toolbar')?.classList.contains('meo-preload-toolbar'));
  };
  const openSettings = async () => { await page.click('.more-tools-wrapper > .format-button'); await page.click('.more-tools-settings-button'); await page.click('[data-tab="appearance"]'); };
  const input = (key: string) => `[data-setting="${key}"] .appearance-color-hex`;
  const edit = async (key: string, color: string) => {
    await page.click(input(key), {clickCount: 3}); await page.keyboard.type(color);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  };
  const value = (key: string) => page.$eval(input(key), element => (element as HTMLInputElement).value);
  const role = (key: string) => page.evaluate(key => { const probe = document.createElement('span'); probe.style.color = 'var(--meo-ui-' + key + ')'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, key);
  const apply = '.appearance-footer .settings-primary';
  const cancel = '.appearance-footer .settings-actions button:first-child';
  const source = () => page.$$eval('.cm-content, .cm-line, .cm-line span, .cm-gutters', elements => elements.map(element => [element.textContent, getComputedStyle(element).color, getComputedStyle(element).backgroundColor]));
  await openFixture(); await openSettings();
  assert.deepEqual(await page.$$eval('.settings-tab-label', elements => elements.map(e => e.textContent)), ['常规', '外观', '输入', '快捷键']);
  await page.click('[data-tab="general"]'); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.$eval('.settings-tab[aria-selected="true"]', e => (e as HTMLElement).dataset.tab), 'shortcuts');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('.settings-tab[aria-selected="true"]', e => (e as HTMLElement).dataset.tab), 'appearance');
  assert.equal(await value('surface'), '');
  assert.equal(await page.$eval('[data-appearance-mode="auto"]', e => e.textContent), '自动');
  const checkControlLayout = async () => {
    await page.waitForFunction(() => document.querySelector('.appearance-mode-control')!.getAnimations({subtree: true}).every(animation => animation.playState !== 'running'));
    assert.deepEqual(await page.evaluate(() => {
      const mode = document.querySelector<HTMLElement>('.appearance-mode-control')!;
      const rect = mode.getBoundingClientRect();
      const title = document.querySelector('[data-setting="mode"] .settings-item-text')!.getBoundingClientRect();
      const colors = [...document.querySelectorAll<HTMLElement>('.appearance-color-controls')].filter(e => e.getBoundingClientRect().width > 0);
      return {
        aligned: colors.every(e => { const color = e.getBoundingClientRect(); return Math.abs(color.left - rect.left) < 1 && Math.abs(color.right - rect.right) < 1; }),
        rightOfTitle: title.right < rect.left && title.top < rect.bottom && title.bottom > rect.top,
        compact: rect.width === 240 && rect.height === 32,
        icons: mode.querySelectorAll('svg[width="12"][height="12"]').length,
        labelsFit: [...mode.querySelectorAll<HTMLElement>('.segmented-control-button-content')].every(e => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e.querySelector('span')!).whiteSpace === 'nowrap')
      };
    }), {aligned: true, rightOfTitle: true, compact: true, icons: 2, labelsFit: true}, 'mode reuses the menu control and aligns with the color column');
  };
  const checkColorFocus = async () => {
    await page.focus('[data-setting="surface"] .appearance-color-swatch');
    assert.deepEqual(await page.$eval('[data-setting="surface"] .appearance-color-field', field => {
      const chip = field.querySelector<HTMLElement>('.appearance-color-chip')!;
      const bounds = field.getBoundingClientRect(); const dot = chip.getBoundingClientRect();
      const style = getComputedStyle(field);
      return {
        contained: dot.left >= bounds.left && dot.right <= bounds.right && dot.top >= bounds.top && dot.bottom <= bounds.bottom,
        noOuterRing: getComputedStyle(chip).outlineStyle === 'none',
        insetFocus: style.boxShadow.includes('inset') && style.borderWidth === '0px'
      };
    }), {contained: true, noOuterRing: true, insetFocus: true}, 'color focus stays inside the borderless field');
  };
  await checkControlLayout();
  await checkColorFocus();
  assert.deepEqual(await page.$$eval('.settings-jump', elements => elements.map(e => e.textContent)), ['界面模式', '基础颜色', '高级颜色']);
  const screenshots = process.env.MEO_UI_COLORS_SCREENSHOT_DIR;
  if (screenshots) await fs.mkdir(screenshots, { recursive: true });
  for (const [index, tab] of ['general', 'appearance', 'typing', 'shortcuts'].entries()) {
    await page.click(`[data-tab="${tab}"]`);
    assert.deepEqual(await page.evaluate(() => {
      const navigation = document.querySelector('.settings-navigation')!;
      const content = document.querySelector('.settings-content')!;
      const jumps = [...navigation.querySelectorAll<HTMLButtonElement>('.settings-jump')];
      const sections = [...content.querySelectorAll<HTMLElement>('.settings-section')];
      return {
        twoColumns: navigation.getBoundingClientRect().width > 0 && navigation.getBoundingClientRect().right <= content.getBoundingClientRect().left,
        matchingSections: jumps.length > 0 && jumps.length === sections.length && jumps.every((jump, index) => sections[index].id === 'meo-settings-' + jump.dataset.section)
      };
    }), {twoColumns: true, matchingSections: true}, tab + ' shares the left navigation/right settings layout');
    if (screenshots) await page.screenshot({path: path.join(screenshots, `${String(53 + index).padStart(3, '0')}-${tab}-layout.png`)});
  }
  await page.click('[data-tab="appearance"]');
  await page.click('[data-section="appearanceAdvanced"]');
  assert.ok(await page.$eval('.settings-content', e => e.scrollTop > 0), 'advanced navigation scrolls the same settings surface');
  await page.waitForFunction(() => document.querySelector('.settings-jump.is-active')?.getAttribute('data-section') === 'appearanceAdvanced');
  assert.equal(await page.$eval('[data-setting="success"]', e => {const item = e.getBoundingClientRect(); const content = document.querySelector('.settings-content')!.getBoundingClientRect(); return item.top >= content.top && item.bottom <= content.bottom;}), true, 'advanced navigation reveals its settings');
  if (screenshots) await page.screenshot({path: path.join(screenshots, '057-appearance-advanced.png')});
  await page.click('[data-section="appearanceMode"]');
  await page.click('.settings-search'); await page.keyboard.type('危险');
  assert.deepEqual(await page.$$eval('.settings-jump', elements => elements.map(e => e.textContent)), ['高级颜色'], 'filtered navigation contains only matching sections');
  await page.click('.settings-search-clear');
  await page.click('[data-tab="general"]'); await page.click('[data-setting="language"] [data-value="en"]'); await page.click('[data-tab="appearance"]');
  assert.equal(await page.$eval('[data-appearance-mode="auto"]', e => e.textContent), 'Auto');
  await checkControlLayout();
  await checkColorFocus();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, '058-appearance-english.png') });
  await page.setViewport({width: 360, height: 740});
  assert.equal(await page.$eval('.settings-content', e => e.scrollWidth <= e.clientWidth), true, 'English color controls fit a narrow window');
  assert.equal(await page.$$eval('.appearance-color-reset svg', elements => elements.every(e => e.getBoundingClientRect().width === 14)), true, 'reset icons remain legible inside compact buttons');
  await checkColorFocus();
  if (screenshots) await page.screenshot({path: path.join(screenshots, '059-appearance-narrow.png')});
  await page.setViewport({width: 1100, height: 820});
  await page.click('[data-tab="general"]'); await page.click('[data-setting="language"] [data-value="zh-CN"]'); await page.click('[data-tab="appearance"]');
  const originalSurface = await role('surface'); const sourceBefore = await source();
  const drag = await page.evaluate(async () => {
    const swatch = document.querySelector<HTMLInputElement>('[data-setting="surface"] .appearance-color-swatch')!;
    const readback = CanvasRenderingContext2D.prototype.getImageData;
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    let samples = 0, feedbackWrites = 0, userWriting = false;
    CanvasRenderingContext2D.prototype.getImageData = function(...args: Parameters<typeof readback>) { samples++; return readback.apply(this, args); };
    Object.defineProperty(HTMLInputElement.prototype, 'value', {...value, set(input) {
      if (this === swatch && !userWriting) feedbackWrites++;
      value.set!.call(this, input);
    }});
    try {
      for (let index = 0; index < 12; index++) {
        userWriting = true; swatch.value = '#2848' + (43 + index).toString(16); userWriting = false;
        swatch.dispatchEvent(new Event('input', {bubbles: true}));
      }
      const synchronousSamples = samples;
      const latestHex = document.querySelector<HTMLInputElement>('[data-setting="surface"] .appearance-color-hex')!.value;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const appliedSamples = samples;
      swatch.dispatchEvent(new Event('input', {bubbles: true}));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {synchronousSamples, appliedSamples, duplicateSamples: samples - appliedSamples, feedbackWrites, latestHex};
    } finally {
      CanvasRenderingContext2D.prototype.getImageData = readback;
      Object.defineProperty(HTMLInputElement.prototype, 'value', value);
    }
  });
  assert.equal(drag.synchronousSamples, 0, 'drag callbacks defer expensive color sampling to the next frame');
  assert.ok(drag.appliedSamples > 0 && drag.appliedSamples < 400, 'one frame derives only the latest selection, rather than every intermediate color');
  assert.equal(drag.duplicateSamples, 0, 'an unchanged selection does not refresh the palette');
  assert.equal(drag.feedbackWrites, 0, 'presenting a draft does not write back into an active color input');
  assert.equal(drag.latestHex, '#284836', 'HEX feedback follows the latest drag event immediately');
  assert.equal(await role('surface'), 'rgb(40, 72, 54)');
  assert.deepEqual(owner.getUiColors(), {light: {}, dark: {}}, 'drag preview does not persist');
  assert.deepEqual(await source(), sourceBefore, 'continuous UI preview retains the Source palette');
  await page.click(cancel);
  for (const action of ['cancel', 'close', 'reset'] as const) {
    await page.evaluate(action => {
      const swatch = document.querySelector<HTMLInputElement>('[data-setting="surface"] .appearance-color-swatch')!;
      swatch.value = '#284836'; swatch.dispatchEvent(new Event('input', {bubbles: true}));
      // Act in the same event turn, before the queued preview gets a frame.
      const selector = action === 'cancel' ? '.appearance-footer .settings-actions button:first-child'
        : action === 'close' ? '.settings-close' : '.appearance-footer > button';
      document.querySelector<HTMLButtonElement>(selector)!.click();
    }, action);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await role('surface'), originalSurface, action + ' prevents a late drag preview from restoring the discarded color');
    if (action === 'close') await openSettings();
  }
  await edit('surface', '#102537'); assert.equal(await role('surface'), 'rgb(16, 37, 55)', 'manual background retains its chroma');
  await edit('text', '#FFD6E5'); assert.equal(await role('text'), 'rgb(255, 214, 229)', 'readable manual text is not neutralized');
  assert.deepEqual(await source(), sourceBefore, 'UI overrides do not recolor Source content');
  assert.deepEqual(owner.getUiColors(), {light: {}, dark: {}}, 'preview does not persist');
  await page.click(cancel); assert.equal(await role('surface'), originalSurface); assert.equal(await value('surface'), '');
  for (const close of ['button', 'escape', 'backdrop'] as const) {
    await edit('surface', '#102537');
    if (close === 'button') await page.click('.settings-close');
    else if (close === 'escape') await page.keyboard.press('Escape');
    else await page.mouse.click(1, 1);
    assert.equal(await role('surface'), originalSurface, close + ' discards preview'); await openSettings();
  }
  await edit('accent', '#1234'); assert.equal(await page.$eval(apply, e => (e as HTMLButtonElement).disabled), true); assert.equal(await page.$eval(input('accent'), e => e.getAttribute('aria-invalid')), 'true');
  await edit('accent', '#2AF'); await page.click('[data-setting="accent"] .appearance-color-reset'); assert.equal(await value('accent'), '');
  await edit('surface', '#102537'); await edit('textEmphasis', '#99CCAA');
  fail = true; await page.click(apply); await page.waitForFunction(() => !document.querySelector<HTMLElement>('.appearance-status')!.hidden);
  assert.equal(await value('surface'), '#102537'); assert.equal(await role('surface'), 'rgb(16, 37, 55)'); assert.deepEqual(owner.getUiColors(), {light: {}, dark: {}});
  fail = false; await page.click(apply); await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.disabled);
  assert.deepEqual(owner.getUiColors(), {light: {}, dark: {surface: '#102537', textEmphasis: '#99CCAA'}});
  await page.click('.settings-close'); await openFixture(); await openSettings();
  assert.equal(await value('surface'), '#102537', 'a reloaded Webview receives persisted colors');
  await page.click('.settings-close'); await page.click('[data-mode="live"]');
  await page.waitForSelector('.meo-md-heading-content');
  assert.equal(await page.$eval('.meo-md-heading-content', e => getComputedStyle(e).color), 'rgb(153, 204, 170)', 'saved content emphasis colors the actual Live heading');
  await openSettings();
  await page.click('[data-appearance-mode="light"]'); assert.equal(await value('surface'), '', 'light profile is independent');
  await checkControlLayout();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, '060-appearance-light.png') });
  await checkColorFocus();
  await edit('surface', '#F8F4EF'); await page.click(apply); await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.disabled);
  assert.equal(owner.getUiColors().light.surface, '#F8F4EF'); assert.equal(owner.getUiColors().dark.surface, '#102537');
  await page.click('[data-appearance-mode="dark"]'); assert.equal(await value('surface'), '#102537');
  await page.setViewport({width: 360, height: 740});
  assert.equal(await page.$eval('.settings-window', e => e.scrollWidth <= e.clientWidth), true, 'narrow window has no horizontal clipping');
  assert.equal(await page.$eval('.settings-content', e => e.scrollWidth <= e.clientWidth), true, 'narrow color controls fit their scroll surface');
  await page.setViewport({width: 1100, height: 820});
  // Host changes rebase only untouched fields of an open draft.
  await edit('surface', '#112638');
  const external = {...owner.getUiColors(), light: {accent: '#005588'}};
  await owner.setUiColors(external); await page.evaluate(colors => window.dispatchEvent(new MessageEvent('message', {data: {type: 'uiColorsChanged', colors}})), external);
  assert.equal(await value('surface'), '#112638'); await page.click(apply); await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.disabled);
  assert.equal(owner.getUiColors().light.accent, '#005588', 'saving preserves unrelated external changes');
  // A response to a closed window must not replace a newly opened draft.
  await page.evaluate(() => { (window as any).__holdColorsReply = true; }); await edit('accent', '#4477CC'); await page.click(apply);
  await page.waitForFunction(() => typeof (window as any).__releaseColorsReply === 'function');
  await page.click('.settings-close'); await openSettings();
  await page.evaluate(() => (window as any).__releaseColorsReply());
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-setting="accent"] .appearance-color-hex')!.disabled);
  assert.equal(await value('accent'), '#4477CC');
  await page.click('[data-appearance-mode="auto"]');
  await page.evaluate(() => { document.body.className = 'vscode-high-contrast'; window.dispatchEvent(new MessageEvent('message', {data: {type: 'vscodeCodeThemeChanged', appearance: 'dark', vscodeTheme: {name: 'HC', type: 'dark', colors: {}, tokenColors: []}}})); });
  assert.equal(await role('surface'), 'rgb(34, 39, 46)', 'high contrast uses native surface instead of saved custom surface');
  assert.ok(await page.$eval('.appearance-note', e => e.textContent?.includes('高对比度')));
  await page.evaluate(() => { document.body.className = 'vscode-dark'; window.dispatchEvent(new MessageEvent('message', {data: {type: 'vscodeCodeThemeChanged', appearance: 'dark', vscodeTheme: {name: 'dark', type: 'dark', colors: {}, tokenColors: []}}})); });
  assert.equal(await role('surface'), 'rgb(17, 38, 56)');
  await page.evaluate(() => {
    const swatch = document.querySelector<HTMLInputElement>('[data-setting="accent"] .appearance-color-swatch')!;
    for (const color of ['#4488AA', '#5599BB']) { swatch.value = color; swatch.dispatchEvent(new Event('input', {bubbles: true})); }
    document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.click();
  });
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.disabled);
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('[data-setting="accent"] .appearance-color-swatch')!.disabled);
  assert.equal(owner.getUiColors().dark.accent, '#5599BB', 'Apply before a preview frame saves the latest drag value');
  assert.equal(await role('accent'), 'rgb(85, 153, 187)');
  await page.click('.appearance-footer > button'); await page.click(apply); await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.appearance-footer .settings-primary')!.disabled);
  assert.deepEqual(owner.getUiColors(), {light: {}, dark: {}}, 'reset clears both profiles after Apply');
  assert.deepEqual(errors, []);
  console.log('Production appearance: drag preview coalescing, immediate Apply/discard, preview/cancel, all close paths, validation, save failure/retry, reload, light/dark isolation, external updates, delayed responses, high contrast and narrow layout passed');
} finally { await closeTestBrowser(browser); }
