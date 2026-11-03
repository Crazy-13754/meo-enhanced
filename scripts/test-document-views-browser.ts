import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import exportRuntime from '../src/export/runtime';
import { launchTestBrowser } from './browser-test-helpers';

const root = process.cwd(), out = path.join(root, '.local/document-view-tests');
const markmapDirectory = process.env.MEO_MARKMAP_DIR;
if (!markmapDirectory) throw new Error('Set MEO_MARKMAP_DIR to the independent meoenhancedmarkmap project directory.');
const { contribution } = await import(pathToFileURL(path.join(markmapDirectory, 'src/contribution.ts')).href);
mkdirSync(out, { recursive: true });
const build = await Bun.build({ entrypoints: [path.join(root, 'scripts/test-webview-viewport-entry.ts')], outdir: out, target: 'browser', format: 'iife', minify: true, naming: 'editor.js' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (!request.url().startsWith('https://document-view.test/')) { void request.continue(); return; }
    requests.push(request.url());
    const asset = request.url().endsWith('/worker.js') ? 'worker.js' : 'view.js';
    void request.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(path.join(markmapDirectory, 'dist', asset)) });
  });
  await page.setContent('<!doctype html><html lang="zh-CN"><body class="vscode-light"><div id="app" class="editor-root"></div></body></html>');
  await page.addStyleTag({ path: path.join(root, 'webview/src/styles.css') });
  await page.addStyleTag({ content: ':root{--vscode-editor-background:#fff;--vscode-editor-foreground:#24292f;--vscode-sideBar-background:#f6f8fa;--vscode-panel-border:#d0d7de;--vscode-toolbar-hoverBackground:#eaeef2;--vscode-font-family:system-ui;--vscode-editor-font-family:system-ui;--vscode-editor-font-size:15px}html,body,#app{height:100%;margin:0}' });
  await page.exposeFunction('__fixtureHost', async (message: any) => {
    if (message.type === 'requestPreviewRender') return { type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: exportRuntime.renderPreviewDocument({
      markdownText: message.text, sourceDocumentPath: 'C:/fixture/mindmap.md', uiLanguage: message.uiLanguage, styleEnvironment: message.environment, preset: message.preset, contentWidth: message.contentWidth, layout: message.layout
    }) } };
    return null;
  });
  await page.addScriptTag({ content: 'window.acquireVsCodeApi=()=>({postMessage(message){window.__fixtureHost(message).then(reply=>{if(reply)window.dispatchEvent(new MessageEvent("message",{data:reply}))})},getState(){return null},setState(){}});' });
  await page.addScriptTag({ path: path.join(out, 'editor.js') });
  const text = '# 旅行计划\n\n## 交通\n\n- 高铁\n- 市内公交\n\n## 行程\n\n- 博物馆\n- 公园\n\n## 注意事项\n\n提前预约。\n';
  const send = (data: unknown) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
  await send({ type: 'init', documentId: 'file:///mindmap.md', text, version: 1, savedRevision: { version: 1, text }, diagnostics: [],
    mode: 'live', uiLanguage: process.argv.includes('--english') ? 'en' : 'zh-CN', sourceLineNumbers: 'on', previewAppearance: 'light', previewFontFamily: '', previewSourceColoring: true, editorAppearance: process.argv.includes('--dark') ? 'dark' : 'light',
    gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false,
    contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: true, outlineWidth: 260, vscodeTheme: null });
  await page.waitForSelector('.editor-host > .cm-editor');
  await page.waitForFunction(() => !document.querySelector('.mode-toolbar')?.classList.contains('meo-preload-toolbar'));
  assert.equal(await page.$('.mm-view-entry'), null); assert.deepEqual(requests, []);
  const catalog = { type: 'documentViewsChanged', views: [{ ...contribution, id: 'test/mindmap', entryUri: 'https://document-view.test/view.js' }] };
  await send(catalog); await page.waitForSelector('.mm-view-entry'); assert.deepEqual(requests, []);
  assert.equal(await page.$eval('.mm-view-entry svg path', e => e.getAttribute('d')), contribution.iconPaths[0]);
  assert.equal(await page.$eval('.mm-view-entry', e => e.textContent), '');
  const waitMap = () => page.waitForFunction(() => !!document.querySelector('.meo-markmap g.markmap-node') && !document.querySelector('.meo-map-status')?.textContent);
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
  const layout = '[data-view-action="layout"]', close = '[data-view-action="close"]';
  async function assertMapFits() {
    assert(await page.evaluate(() => {
      const canvas = document.querySelector('.meo-markmap')!.getBoundingClientRect();
      const toolbar = document.querySelector('.document-view-toolbar')!.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('g.markmap-node')].map(node => node.getBoundingClientRect());
      return nodes.length > 0 && nodes.every(node => node.top >= canvas.top - 1
        && node.bottom <= toolbar.top - 8 + 1 && node.left >= canvas.left - 1 && node.right <= canvas.right + 1);
    }), 'Fit keeps every visible node inside the canvas above the floating toolbar');
  }
  async function dragCanvas() {
    const box = await page.$eval('.meo-markmap', e => { const r = e.getBoundingClientRect(); return { x: r.left + 35, y: r.top + 65 }; });
    const before = await page.$eval('.meo-markmap > g', e => e.getAttribute('transform'));
    const selectionDisabled = await page.$eval('[data-view-action="locate"]', e => (e as HTMLButtonElement).disabled);
    assert.equal(await page.$eval('.meo-markmap', e => getComputedStyle(e).cursor), 'default');
    await page.mouse.move(box.x, box.y); await page.mouse.down();
    assert.equal(await page.$eval('.meo-markmap', e => getComputedStyle(e).cursor), 'default', 'Pressing without dragging keeps the arrow');
    await page.mouse.move(box.x + 2, box.y + 1);
    assert.equal(await page.$eval('.meo-markmap', e => getComputedStyle(e).cursor), 'default', 'Small click jitter keeps the arrow');
    await page.mouse.move(box.x + 80, box.y + 35, { steps: 6 });
    assert.equal(await page.$eval('.meo-markmap', e => getComputedStyle(e).cursor), 'grabbing');
    await page.mouse.up();
    await settle();
    const after = await page.$eval('.meo-markmap > g', e => e.getAttribute('transform'));
    assert.notEqual(after, before, 'Dragging blank canvas must move the map');
    assert.equal(await page.$eval('.meo-markmap', e => getComputedStyle(e).cursor), 'default');
    assert.equal(await page.$eval('[data-view-action="locate"]', e => (e as HTMLButtonElement).disabled), selectionDisabled, 'Dragging blank canvas retains the selection');
  }
  await page.click('.mm-view-entry'); await waitMap();
  await settle(); await assertMapFits();
  assert.equal(await page.$eval('.meo-markmap .markmap-node > circle', e => getComputedStyle(e).cursor), 'default');
  assert(await page.$eval('.mm-view-panel', e => e.classList.contains('is-side')), 'The toolbar opens the map beside the document');
  assert.equal(await page.$('.mm-view-head'), null);
  assert.equal(await page.$('.meo-map-tools'), null);
  const zoom = () => page.$eval('.meo-markmap', e => (e as any).__zoom.k as number);
  const initialZoom = await zoom();
  await page.click('[data-view-action="zoom-in"]'); await settle();
  assert((await zoom()) > initialZoom, 'Contributed zoom action must control the actual map');
  await page.click('[data-view-action="zoom-out"]'); await settle();
  assert(Math.abs((await zoom()) - initialZoom) < .001);
  await page.click('[data-view-action="fit"]'); await settle();
  await page.click(layout); await settle();
  await dragCanvas();
  const label = await page.$('g.markmap-node[aria-label="交通"] foreignObject');
  assert(label);
  assert.equal(await label.evaluate(e => getComputedStyle(e).cursor), 'default');
  const labelBox = await label.boundingBox(); assert(labelBox);
  const beforeTextDrag = await page.$eval('.meo-markmap > g', e => e.getAttribute('transform'));
  await page.mouse.move(labelBox.x + 8, labelBox.y + 8); await page.mouse.down();
  assert.equal(await label.evaluate(e => getComputedStyle(e).cursor), 'default');
  await page.mouse.move(labelBox.x + 65, labelBox.y + 25, { steps: 8 });
  assert.equal(await label.evaluate(e => getComputedStyle(e).cursor), 'grabbing');
  await page.mouse.up();
  assert.equal(await label.evaluate(e => getComputedStyle(e).cursor), 'default');
  assert.notEqual(await page.$eval('.meo-markmap > g', e => e.getAttribute('transform')), beforeTextDrag);
  assert.equal(await page.$eval('.mm-view-panel', e => e.classList.contains('is-side')), false, 'Dragging labels must not navigate');
  assert.equal(await page.$eval('.editor-wrapper', e => getComputedStyle(e).visibility), 'hidden');
  assert.equal(requests.length, 2);
  await send({ type: 'docChanged', version: 2, text: text + '\n## 外部更新\n' });
  await page.waitForFunction(() => document.querySelector('.meo-markmap')?.textContent?.includes('外部更新'));
  await send({ type: 'docChanged', version: 3, text });
  await page.waitForFunction(() => !document.querySelector('.meo-markmap')?.textContent?.includes('外部更新'));
  await waitMap();
  const camera = await page.$eval('.meo-markmap > g', e => e.getAttribute('transform'));
  await page.click(layout); await settle();
  await dragCanvas();
  const sideCamera = await page.$eval('.meo-markmap > g', e => e.getAttribute('transform'));
  assert(Number(sideCamera?.match(/scale\(([^)]+)\)/)?.[1]) < Number(camera?.match(/scale\(([^)]+)\)/)?.[1]));
  assert(await page.evaluate(() => {
    const map = document.querySelector('.mm-view-panel')!.getBoundingClientRect(), outline = document.querySelector('.outline-sidebar')!.getBoundingClientRect();
    return Math.abs(map.right - outline.left) < 2 && outline.width > 0 && document.querySelector('.mm-view-panel')!.parentElement!.classList.contains('editor-surface');
  }));
  await page.click('button[data-mode="source"]'); await page.waitForSelector('.mm-view-panel.is-side');
  await page.click('.editor-host .cm-content'); await dragCanvas();
  await page.click('.source-preview-button');
  await page.waitForFunction(() => document.querySelector('.editor-surface')?.hasAttribute('data-source-preview'));
  await page.waitForFunction(() => {
    const host = document.querySelector<HTMLElement>('.preview-host');
    return host && !host.inert && getComputedStyle(host).visibility === 'visible'
      && document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('h1')?.textContent === '旅行计划';
  });
  await settle();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.preview-loading')?.hidden === true);
  await settle();
  assert(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden));
  assert.equal(await page.$('.mm-view-preview-choice'), null);
  assert.equal(await page.$eval('.preview-host', e => getComputedStyle(e).paddingTop), '0px', 'Installing a view must not add a title row to the built-in preview');
  await page.screenshot({ path: path.join(out, process.argv.includes('--dark') ? 'side-preview-dark.png' : 'side-preview-light.png') });
  await page.click('.mm-view-entry'); await waitMap();
  assert.equal(await page.$eval('.editor-surface', e => e.hasAttribute('data-source-preview')), false);
  await page.click(close); await settle();
  assert.equal(await page.$eval('.editor-surface', e => e.hasAttribute('data-source-preview')), false);
  assert.equal(await page.$eval('.editor-wrapper', e => getComputedStyle(e).visibility), 'visible');
  await page.click('.mm-view-entry'); await waitMap();
  // A document transaction (not a DOM input event) must refresh the view.
  await page.evaluate(() => {
    const view = (window as any).__viewportTestView(); view.dispatch({ changes: { from: view.state.doc.length, insert: '\n## 新章节\n\n- 新节点\n' } });
  });
  await page.waitForFunction(() => document.querySelector('.meo-markmap')?.textContent?.includes('新节点'));
  await waitMap(); await settle();
  // Folding persists when an unrelated source line is inserted.
  await page.click('g.markmap-node[aria-label="交通"] circle');
  await page.waitForSelector('g.markmap-node.markmap-fold[aria-label="交通"]');
  await page.waitForFunction(() => !document.querySelector('g.markmap-node[aria-label="高铁"]'));
  await page.evaluate(() => { const view = (window as any).__viewportTestView(); view.dispatch({ changes: { from: 0, insert: '\n' } }); });
  await page.waitForFunction(() => {
    const node = document.querySelector('g.markmap-node[aria-label="交通"]') as (SVGGElement & { __data__?: { payload?: { lines?: string } } }) | null;
    return Number(String(node?.__data__?.payload?.lines).split(',')[0]) === 3 && !document.querySelector('.meo-map-status')?.textContent;
  });
  await settle();
  assert.equal(await page.$('g.markmap-node[aria-label="高铁"]'), null);
  await page.waitForSelector('.mm-view-panel .meo-preview-viewport-alignment:not([hidden])');
  assert(await page.$eval('.mm-view-panel [data-meo-align-viewport="source"]', e => (e as HTMLButtonElement).disabled));
  await page.click('.mm-view-panel [data-meo-align-viewport="preview"]'); await settle();
  assert.equal(await page.$eval('.mm-view-panel [data-meo-align-viewport="source"]', e => (e as HTMLButtonElement).disabled), false);
  await page.click('g.markmap-node[aria-label="交通"]');
  await page.waitForSelector('[data-view-action="locate"]:not(:disabled)');
  await dragCanvas();
  const blank = await page.$eval('.meo-markmap', e => { const r = e.getBoundingClientRect(); return { x: r.left + 35, y: r.top + 65 }; });
  await page.mouse.click(blank.x, blank.y); await settle();
  const leftArrow = '.mm-view-panel [data-meo-align-viewport="source"]';
  assert(await page.$eval(leftArrow, e => (e as HTMLButtonElement).disabled), 'Blank click clears selected source position');
  assert(await page.$eval('[data-view-action="locate"]', e => (e as HTMLButtonElement).disabled));
  assert.equal(await page.$('.markmap-highlight rect'), null, 'Blank click also removes the visible highlight');
  const emptyHint = process.argv.includes('--english') ? 'Select an item first' : '请先选择';
  assert.equal(await page.$eval(leftArrow, e => (e as HTMLElement).dataset.tooltip), emptyHint);
  await page.hover(leftArrow);
  await page.waitForFunction(text => document.querySelector('.meo-tooltip.is-visible .meo-tooltip-label')?.textContent === text, {}, emptyHint);
  await page.screenshot({ path: path.join(out, process.argv.includes('--dark') ? 'empty-selection-dark.png' : 'empty-selection-light.png') });
  await page.click('[data-view-action="fit"]'); await settle();
  await page.click('g.markmap-node[aria-label="交通"]'); await settle();
  assert.equal(await page.$eval(leftArrow, e => (e as HTMLButtonElement).disabled), false);
  assert.equal(await page.$eval(leftArrow, e => (e as HTMLElement).dataset.tooltip), process.argv.includes('--english') ? 'Locate selection in document' : '按所选内容定位正文');
  await page.click('[data-view-action="locate"]'); await settle();
  assert(await page.$eval('.mm-view-panel', e => e.classList.contains('is-side')), 'Toolbar locate remains available in split view');
  await page.click('.mm-view-panel [data-meo-align-viewport="source"]'); assert.equal(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden), false);
  await page.screenshot({ path: path.join(out, process.argv.includes('--dark') ? 'side-dark.png' : 'side-light.png') });
  await page.setViewport({ width: 760, height: 800 }); await settle();
  assert(await page.$eval('.document-view-toolbar', toolbar => {
    const panel = toolbar.closest('.mm-view-panel')!.getBoundingClientRect(), bounds = toolbar.getBoundingClientRect();
    const buttons = [...toolbar.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return Math.abs((bounds.left + bounds.right - panel.left - panel.right) / 2) < 1
      && buttons.every(button => Math.abs(button.top - buttons[0]!.top) < 1)
      && toolbar.scrollWidth <= toolbar.clientWidth + 1;
  }), 'The complete toolbar stays centered on one line in a narrow split');
  await page.focus('.mm-view-entry');
  await page.hover('.source-preview-button');
  await page.screenshot({ path: path.join(out, process.argv.includes('--dark') ? 'toolbar-narrow-dark.png' : 'toolbar-narrow-light.png') });
  await page.setViewport({ width: 1280, height: 800 }); await settle();
  await page.click(layout); await settle();
  await page.waitForSelector('[data-view-action="locate"]:not(:disabled)');
  await page.screenshot({ path: path.join(out, process.argv.includes('--dark') ? 'full-dark.png' : 'full-light.png') });
  await page.click('g.markmap-node[aria-label="交通"] foreignObject', { clickCount: 2 }); await settle();
  assert.equal(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden), false);
  assert(await page.$eval('.mm-view-panel', e => e.classList.contains('is-side')));
  assert.equal(await page.$eval('.editor-wrapper', e => (e as HTMLElement).inert), false);
  assert(await page.$('g.markmap-node.markmap-fold[aria-label="交通"]'), 'Navigation retains the map and folded nodes');
  await dragCanvas();
  await page.screenshot({ path: path.join(out, 'navigation-side.png') });
  // A tall tree must shrink to the unobstructed height, not just shift upward.
  const tallMap = '# Tall map\n' + Array.from({ length: 40 }, (_, i) => `- Node ${i + 1}\n`).join('');
  await page.evaluate(text => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, tallMap);
  await page.waitForSelector('g.markmap-node[aria-label="Node 40"]');
  await waitMap();
  await page.setViewport({ width: 1280, height: 480 }); await settle();
  await page.click('[data-view-action="fit"]'); await settle(); await assertMapFits();
  await page.click(layout); await settle();
  await page.click('[data-view-action="fit"]'); await settle(); await assertMapFits();
  await page.screenshot({ path: path.join(out, 'fit-above-toolbar.png') });
  await page.click(layout); await settle();
  await page.setViewport({ width: 1280, height: 800 }); await settle();
  // Preview navigation shares the source marker and must reveal an offscreen block.
  const longText = '# 旅行计划\n\n' + Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段行程说明。\n\n`).join('') + '## 终点\n\n到达目的地。\n';
  await page.evaluate(text => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, longText);
  await page.waitForSelector('g.markmap-node[aria-label="终点"]');
  await page.click('button[data-mode="preview"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.right-tools-separator')?.hidden === false);
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('h2')?.textContent === '终点');
  await settle();
  await page.$eval('g.markmap-node[aria-label="终点"] foreignObject', e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForFunction(() => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
    const marker = doc?.querySelector<HTMLElement>('.meo-preview-source-position-marker');
    const target = doc?.querySelector('h2')?.getBoundingClientRect();
    return marker && !marker.hidden && marker.dataset.meoSourcePositionLine === '123'
      && target && target.top >= 0 && target.bottom <= doc!.documentElement.clientHeight;
  });
  assert.equal(await page.$eval('#app', e => (e as HTMLElement).dataset.mode), 'preview');
  await page.screenshot({ path: path.join(out, 'preview-navigation.png') });
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector<HTMLElement>('.meo-preview-source-position-marker')?.hidden);
  await page.focus('.mm-view-canvas');
  await page.keyboard.press('Escape');
  assert(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden));
  await page.click('.mm-view-entry'); await waitMap(); await send({ type: 'documentViewsChanged', views: [] });
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.right-tools-separator')?.hidden === true);
  assert.equal(await page.$('.mm-view-entry'), null); assert(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden));
  assert.equal(await page.$eval('.editor-wrapper', e => (e as HTMLElement).inert), false);
  const compatibility = await page.evaluate(async () => {
    const moduleUri = 'https://document-view.test/view.js';
    const renderer = await import(moduleUri);
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--meo-background)'; document.body.append(container);
    let selected: number | null = null;
    const instance = renderer.mount(container, { language: 'zh-CN', revealLine() {}, selectionChanged(line: number | null) { selected = line; } });
    const text = '---\nmarkmap:\n  maxWidth: 240\n---\n# Project\n## Risks <!-- fold: this; color: white; bgColor: red -->\n- [x] Done\n- Formula $x^2$\n## Goals <!-- fold: tree -->\n- [[Note|Alias]]\n';
    try {
      await instance.update({ text, revision: 1 });
      const folded = !!container.querySelector('.markmap-fold[aria-label="Risks "]') || [...container.querySelectorAll('.markmap-fold')].some(n => n.textContent?.trim() === 'Risks');
      const scale = (container.querySelector('svg') as any).__zoom.k;
      await instance.revealLine(8);
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      const risk = [...container.querySelectorAll('g.markmap-node')].find(n => n.textContent?.trim() === 'Risks');
      return { folded, math: !!container.querySelector('math'), task: container.textContent?.includes('☑ Done'),
        otherFolded: [...container.querySelectorAll('.markmap-fold')].some(n => n.textContent?.trim() === 'Goals'),
        color: (risk?.querySelector('foreignObject > div > div') as HTMLElement)?.style.color,
        selected, scalePreserved: (container.querySelector('svg') as any).__zoom.k === scale,
        unsafe: !!container.querySelector('img, a, script') };
    } finally { instance.dispose(); container.remove(); }
  });
  assert.deepEqual(compatibility, { folded: true, math: true, task: true, otherFolded: true, color: 'white', selected: 8, scalePreserved: true, unsafe: false });
  assert.deepEqual(errors, []);
  console.log('PASS: optional lazy loading, real Markmap worker, full/side layout, Source exclusivity, document transactions, folds, navigation, close/Escape, unregister.');
} finally { await browser.close(); }
