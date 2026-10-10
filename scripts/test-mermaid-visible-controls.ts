import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-block-sticky-header-production-entry.ts'], target: 'browser', format: 'iife' });
assert.ok(build.success, build.logs.map(String).join('\n'));
const browser = await launchTestBrowser();
let primary: unknown;
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1050, height: 650 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addStyleTag({ content: ':root{--meo-background:#24292e;--meo-foreground:#e6edf3;--meo-code-background:#1b2024;--meo-font-live:Arial;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-size:14px;--meo-semantic-codeCopyForeground:#b6c2ce;--meo-semantic-codeCopyHoverBackground:#30363d}' });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  await page.evaluate(() => {
    (window as any).mermaid = { initialize() {}, async render(_id: string, source: string) {
      const height = source.includes('tall') ? 1800 : 100;
      return { svg: `<svg width="320" height="${height}" viewBox="0 0 320 ${height}"><rect x="60" y="10" width="200" height="60" fill="#282e33" stroke="#66717c"/><text x="130" y="45" fill="#e6edf3">Diagram</text><path d="M160 70v${height - 90}" stroke="#89b4fa"/></svg>` };
    } };
    (window as any).BlockStickyHeaderHarness.bindTooltips(document.body);
  });
  const settle = () => page.evaluate(async () => {
    for (let i = 0; i < 10; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  const mount = async (tall: boolean) => {
    await page.evaluate(tall => {
      const host = window as any;
      host.controlsEditor?.destroy(); document.querySelector('#app')!.replaceChildren();
      host.controlsEditor = host.BlockStickyHeaderHarness.createEditor({ parent: document.querySelector('#app'),
        text: 'Before\n\n```mermaid\nflowchart TD\nA[' + (tall ? 'tall' : 'short') + '] --> B\n```\n\n'
          + Array.from({ length: 80 }, (_, i) => 'Paragraph ' + i).join('\n\n'),
        initialMode: 'live', uiLanguage: 'zh-CN', sourceLineNumbers: 'on', onApplyChanges() {} });
    }, tall);
    await page.waitForSelector('.meo-mermaid-block svg'); await settle();
  };
  const dock = '.meo-mermaid-preview-controls:not(.is-outside-viewport)';
  const assertPosition = async (context: string) => {
    await page.mouse.move(0, 0);
    await settle();
    if (!await page.$(dock)) {
      const diagnostic = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.meo-mermaid-block, .meo-mermaid-preview-controls, #app > .cm-editor > .cm-scroller, .meo-rendered-block-preview-pane'), node => ({
        class: node.className, rect: node.getBoundingClientRect().toJSON(), columns: node.dataset.meoControlsColumns,
        display: getComputedStyle(node).display, grid: getComputedStyle(node).gridTemplateColumns,
        padding: getComputedStyle(node).padding, box: getComputedStyle(node).boxSizing
      })));
      console.error(context, JSON.stringify(diagnostic), errors);
      throw new Error(`${context}: no visible controls`);
    }
    const bounds = await page.$eval(dock, controls => {
      const root = controls.closest('.meo-mermaid-block')!.getBoundingClientRect();
      const scroller = document.querySelector('#app > .cm-editor > .cm-scroller')!.getBoundingClientRect();
      const rect = controls.getBoundingClientRect();
      const pane = controls.closest('.meo-rendered-block-preview-pane')?.getBoundingClientRect();
      return { rect: rect.toJSON(), left: Math.max(root.left, scroller.left, pane?.left ?? 0),
        right: Math.min(root.right, scroller.right, innerWidth, pane?.right ?? innerWidth),
        top: Math.max(root.top, scroller.top), bottom: Math.min(root.bottom, scroller.bottom, innerHeight, pane?.bottom ?? innerHeight) };
    });
    assert.ok(Math.abs(bounds.rect.right - (bounds.right - 6)) < 2, `${context}: right ${JSON.stringify(bounds)}`);
    assert.ok(Math.abs(bounds.rect.bottom - (bounds.bottom - 6)) < 2, `${context}: bottom ${JSON.stringify(bounds)}`);
    assert.ok(bounds.rect.left >= bounds.left && bounds.rect.top >= bounds.top, `${context}: controls stay inside the visible diagram`);
    const appearance = await page.$eval(dock, controls => {
      let opacity = 1;
      for (let node: Element | null = controls; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
      }
      return { opacity, visibility: getComputedStyle(controls).visibility,
        hovered: controls.closest('.meo-mermaid-block')!.matches(':hover') };
    });
    assert.equal(appearance.hovered, false, `${context}: test pointer stays outside the diagram`);
    assert.equal(appearance.opacity, 0, `${context}: controls hidden outside the diagram`);
    await page.mouse.move(bounds.rect.left + bounds.rect.width / 2, bounds.rect.top + bounds.rect.height / 2);
    await settle();
    const hovered = await page.$eval(dock, controls => ({
      opacity: Number(getComputedStyle(controls).opacity),
      visibility: getComputedStyle(controls).visibility,
      pointerEvents: getComputedStyle(controls).pointerEvents,
      diagramHovered: controls.closest('.meo-mermaid-block')!.matches(':hover')
    }));
    assert.equal(hovered.diagramHovered, true, `${context}: pointer enters the diagram`);
    assert.equal(hovered.visibility, 'visible', `${context}: controls visible on diagram hover`);
    assert.equal(hovered.opacity, 1, `${context}: controls revealed on diagram hover`);
    assert.equal(hovered.pointerEvents, 'auto', `${context}: revealed controls accept clicks`);
    assert.equal(await page.$$eval('.meo-mermaid-preview-controls', nodes => nodes.length), 1, 'One owner/group, including floating headers');
    assert.equal(await page.$$eval('.meo-mermaid-toolbar .meo-visual-control-btn', nodes => nodes.length), 0);
  };
  await mount(false); await assertPosition('short');
  await page.mouse.move(0, 0);
  await page.$eval(dock + ' button', button => (button as HTMLElement).focus({ preventScroll: true }));
  await settle();
  assert.equal(await page.$eval(dock, controls => Number(getComputedStyle(controls).opacity)), 1, 'Keyboard focus reveals the controls without pointer hover');
  await page.$eval(dock + ' button', button => (button as HTMLElement).blur()); await settle();
  const icon = await page.$eval('.meo-mermaid-mode-btn svg', node => node.innerHTML);
  let fixedWidth: number | undefined;
  for (const [mode, text] of [['preview', '预览'], ['split', '分栏'], ['source', '源码'], ['preview', '预览']]) {
    const state = await page.$eval('.meo-mermaid-toolbar', node => {
      const button = node.querySelector('.meo-mermaid-mode-btn')!;
      return { mode: (node as HTMLElement).dataset.meoMermaidMode, text: button.textContent, width: button.getBoundingClientRect().width,
        icon: button.querySelector('svg')!.innerHTML, count: node.querySelectorAll(':scope > button, :scope > [role="button"]').length,
        menu: node.querySelector('summary, [aria-haspopup]') !== null };
    });
    assert.equal(state.mode, mode); assert.equal(state.text, text); assert.equal(state.icon, icon);
    fixedWidth ??= state.width;
    assert.equal(state.width, fixedWidth); assert.equal(state.count, 3); assert.equal(state.menu, false);
    if (mode === 'source') assert.equal(await page.$(dock), null);
    else await assertPosition(mode);
    if (mode === 'preview' && fixedWidth && text === '预览' && await page.evaluate(() => (window as any).__cycled)) break;
    await page.$eval('.meo-mermaid-mode-btn', node => (node as HTMLElement).click()); await settle();
    await page.evaluate(() => { (window as any).__cycled = true; });
  }
  await mount(true);
  for (const scrollTop of [0, 260, 700, 1300]) {
    await page.evaluate(scrollTop => { (window as any).controlsEditor.view.scrollDOM.scrollTop = scrollTop; }, scrollTop);
    await settle(); await assertPosition(`tall/${scrollTop}`);
  }
  assert.equal(await page.$$eval('.meo-block-sticky-header:not([hidden]) .meo-mermaid-toolbar > button, .meo-block-sticky-header:not([hidden]) .meo-mermaid-toolbar > [role="button"]', nodes => nodes.length), 3);
  const before = await page.evaluate(() => { const editor = (window as any).controlsEditor; return {
    text: editor.getText(), selection: editor.view.state.selection.toJSON(), height: editor.view.contentHeight, history: editor.getHistoryDepth()
  }; });
  const transform = await page.$eval('.meo-mermaid-svg-wrapper', node => (node as HTMLElement).style.transform);
  await page.click(dock + ' button:first-child'); await settle();
  assert.notEqual(await page.$eval('.meo-mermaid-svg-wrapper', node => (node as HTMLElement).style.transform), transform);
  await page.click(dock + ' button:nth-child(3)'); await settle();
  assert.deepEqual(await page.evaluate(() => { const editor = (window as any).controlsEditor; return {
    text: editor.getText(), selection: editor.view.state.selection.toJSON(), height: editor.view.contentHeight, history: editor.getHistoryDepth()
  }; }), before, 'Preview actions do not modify document layout, selection or history');
  await page.click(dock + ' button:nth-child(4)'); await settle();
  assert.ok(await page.$('.meo-mermaid-fullscreen-scrim')); assert.equal(await page.$(dock), null);
  await page.keyboard.press('Escape'); await settle(); await assertPosition('fullscreen return');
  await page.evaluate(() => { document.querySelector<HTMLElement>('#app')!.style.transform = 'scale(0.85)'; document.querySelector<HTMLElement>('#app')!.style.transformOrigin = 'top left'; });
  await settle(); await assertPosition('transformed host');
  await page.evaluate(() => { document.querySelector<HTMLElement>('#app')!.style.transform = ''; }); await settle();
  await page.evaluate(() => { (window as any).controlsEditor.view.scrollDOM.scrollTop = 0; }); await settle();
  await page.setViewport({ width: 220, height: 650 }); await settle();
  await page.evaluate(() => { (window as any).controlsEditor.view.scrollDOM.scrollTop = 0; }); await settle();
  await assertPosition('narrow');
  assert.equal(await page.$eval(dock, node => (node as HTMLElement).dataset.meoControlsColumns), '2');
  await page.setViewport({ width: 1050, height: 650 }); await settle();
  await page.evaluate(() => { const view = (window as any).controlsEditor.view; view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(6).to).bottom - 5; });
  await settle(); assert.equal(await page.$(dock), null, 'Tiny remaining visible strip hides the controls');
  await page.evaluate(() => { (window as any).controlsEditor.view.scrollDOM.scrollTop = 700; }); await settle();
  await page.evaluate(() => (window as any).controlsEditor.setUiLanguage('en')); await settle();
  assert.equal(await page.$eval('.meo-block-sticky-header .meo-mermaid-mode-label', node => node.textContent), 'Preview');
  fs.mkdirSync('.local/mermaid-controls', { recursive: true });
  await page.screenshot({ path: '.local/mermaid-controls/tall-dark.png' });
  await page.$eval('.meo-block-sticky-header .meo-mermaid-mode-btn', node => (node as HTMLElement).click()); await settle();
  await assertPosition('tall split');
  await page.screenshot({ path: '.local/mermaid-controls/split-dark.png' });
  assert.deepEqual(errors, []);
  await page.evaluate(() => (window as any).controlsEditor.destroy());
  assert.equal(await page.$('.meo-mermaid-preview-controls'), null, 'Disposal removes the group');
  console.log('Mermaid visible controls passed: three-action cyclic modes, current labels/fixed icon/width, short/tall/scroll/split/narrow/transform/fullscreen/hidden/disposal and layout stability');
} catch (error) {
  primary = error;
} finally {
  if (primary === undefined) await closeTestBrowser(browser);
  else await closeTestBrowser(browser, primary);
}
