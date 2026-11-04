import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FixtureEvent, installWorkspaceFixture } from './workspace-documents-fixture';
import { createBackgroundPreviewRenderer } from '../src/host/previewRenderWorker';
import { launchTestBrowser } from './browser-test-helpers';

const root = process.cwd(), extras = process.env.MEO_EXTRAS_DIR;
if (!extras) throw new Error('Set MEO_EXTRAS_DIR to the built Extras directory');
const out = path.join(root, '.local/task-overview-tests'); mkdirSync(out, { recursive: true });
console.log('Preparing task browser fixture');
const a = 'file:///workspace/meeting.md', b = 'file:///workspace/plan.md', c = 'file:///workspace/closed.md';
const initial = '# 项目会议\n\n- [ ] 整理需求\n- [x] 已确认范围\n\n```md\n- [ ] 示例不是任务\n```\n';
const fixture = installWorkspaceFixture({ [a]: initial, [b]: '# 开发计划\n\n- [ ] 修复导出\n', [c]: '# Closed\r\n- [ ] native task\r\n' });
const { createWorkspaceDocumentsHost } = await import('../src/host/workspaceDocuments');
console.log('Workspace host loaded');
const worker = createBackgroundPreviewRenderer(path.join(root, 'dist/preview-render-worker.js'));
const owner = createWorkspaceDocumentsHost({ parseLists: worker.readLists, open: async (uri, line) => { assert(await owner.reveal(uri, line)); } });
const build = await Bun.build({ entrypoints: [path.join(root, 'scripts/test-webview-viewport-entry.ts')], outdir: out, target: 'browser', format: 'iife', minify: true, naming: 'editor.js' });
console.log('Editor fixture built');
assert(build.success, build.logs.map(String).join('\n'));
const parseWorker = await Bun.build({ entrypoints: ['webview/src/markdownParseWorker.ts'], target: 'browser', format: 'iife' }); assert(parseWorker.success);
const browser = await launchTestBrowser();
console.log('Task browser launched');
const closes: (() => void)[] = [], errors: string[] = [], loads: string[] = [];
let enabled = true;
const catalog = { type: 'documentViewsChanged', views: [{ id: 'extras/tasks', label: 'Task overview', labelZh: '任务总览', workspace: true, presentation: 'list', entryUri: 'https://task-view.test/view.js', iconPaths: ['M4 6h16M4 12h16M4 18h16'] }] };
try {
  async function history(page: any, redo = false) {
    await page.keyboard.down('Control'); if (redo) await page.keyboard.down('Shift');
    await page.keyboard.press('z'); if (redo) await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  }
  async function editor(uri: string, mode: 'live' | 'preview' = 'live') {
    const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 800 });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url() === 'https://task-view.test/view.js') { loads.push(request.url()); void request.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(path.join(extras!, 'dist/tasks/view.js')) }); }
      else void request.continue();
    });
    const incoming = new FixtureEvent<unknown>(), closed = new FixtureEvent<void>();
    const send = (data: unknown) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
    const panel: any = { reveal() {}, onDidDispose: closed.event, webview: { onDidReceiveMessage: incoming.event, postMessage: async (message: any) => { await send(message); return true; } } };
    fixture.open.add(uri);
    const connection = owner.attach(panel, fixture.documents.get(uri)! as any, async () => {}, () => enabled);
    closes.push(() => closed.fire());
    await page.setContent('<!doctype html><html lang="zh-CN"><body class="vscode-light"><div id="app" class="editor-root"></div></body></html>');
    await page.addStyleTag({ path: path.join(root, 'webview/src/styles.css') });
    await page.addStyleTag({ content: ':root{--vscode-editor-background:#fff;--vscode-editor-foreground:#24292f;--vscode-sideBar-background:#f6f8fa;--vscode-font-family:system-ui;--vscode-editor-font-family:system-ui;--vscode-editor-font-size:15px}html,body,#app{height:100%;margin:0}' });
    await page.evaluate(source => { document.body.dataset.meoMarkdownWorkerSrc = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); }, await parseWorker.outputs[0]!.text());
    await page.exposeFunction('__fixtureHost', async (message: any) => {
      if (message.type === 'applyChanges') {
        const doc = fixture.documents.get(uri)!;
        if (doc.version !== message.baseVersion) return { type: 'docChanged', text: doc.text, version: doc.version };
        let text = doc.text; for (const change of [...message.changes].sort((x: any, y: any) => y.from - x.from)) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
        fixture.change(uri, text); return { type: 'applied', version: doc.version };
      }
      if (message.type === 'requestPreviewRender') return { type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: await worker.render('task-preview', { markdownText: message.text, sourceDocumentPath: 'C:/fixture/task.md', uiLanguage: message.uiLanguage, styleEnvironment: message.environment, preset: message.preset, contentWidth: message.contentWidth, layout: message.layout }) } };
      if (message.type === 'requestDocumentRevision') { const doc = fixture.documents.get(uri)!; return { type: 'documentRevisionResult', requestId: message.requestId, result: { ok: true, value: { text: doc.text, version: doc.version } } }; }
      incoming.fire(message); return null;
    });
    await page.addScriptTag({ content: 'let fixtureState=null;window.acquireVsCodeApi=()=>({postMessage(message){window.__fixtureHost(message).then(reply=>{if(reply)window.dispatchEvent(new MessageEvent("message",{data:reply}))})},getState(){return fixtureState},setState(state){fixtureState=state}});' });
    await page.addScriptTag({ path: path.join(out, 'editor.js') });
    const text = fixture.documents.get(uri)!.text;
    await send({ type: 'init', documentId: uri, text, version: fixture.documents.get(uri)!.version, savedRevision: { version: fixture.documents.get(uri)!.version, text }, diagnostics: [], mode, uiLanguage: 'zh-CN', sourceLineNumbers: 'on', previewAppearance: 'light', previewFontFamily: '', previewSourceColoring: true, editorAppearance: 'light', gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: true, outlineWidth: 260, vscodeTheme: null });
    if (mode === 'live') await page.waitForSelector('.editor-host > .cm-editor');
    else await page.waitForFunction(() => !!document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-task-checkbox'));
    await page.waitForFunction(() => !document.querySelector('.mode-toolbar')?.classList.contains('meo-preload-toolbar'));
    return { page, send, connection };
  }
  const first = await editor(a), second = await editor(b), page = first.page;
  await page.bringToFront();
  console.log('Two production editors initialized');
  await first.send(catalog); assert.equal(loads.length, 0, 'Enabling tasks does not load its module');
  await page.click('[data-view-id="extras/tasks"]');
  await page.waitForSelector('.meo-tasks'); console.log('Task UI mounted');
  await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 2);
  console.log('Current document task rows loaded');
  async function measureTaskUpdate(label: 'ordinary' | 'large') {
    const timing = await page.evaluate(async large => {
      const started = performance.now(), view = (window as any).__viewportTestView();
      const at = large ? view.state.doc.length - 1 : view.state.doc.line(3).to;
      view.dispatch({ changes: { from: at, insert: ' task-update-probe' } });
      while (![...document.querySelectorAll('.task-label')].some(e => e.textContent?.includes('task-update-probe'))) {
        if (performance.now() - started > 3000) throw new Error('Task update exceeded 3 seconds');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const elapsed = performance.now() - started;
      view.dispatch({ changes: { from: at, to: at + ' task-update-probe'.length, insert: '' } });
      return elapsed;
    }, label === 'large');
    await page.waitForFunction(() => ![...document.querySelectorAll('.task-label')].some(e => e.textContent?.includes('task-update-probe')));
    console.log(`Task update latency (${label}): ${timing.toFixed(1)}ms`);
    assert(timing < 350, `${label} task updates must not stack idle waits`);
  }
  await measureTaskUpdate('ordinary');
  assert.equal(await page.$('[data-view-action="locate"]'), null, 'Task rows navigate directly; no duplicate locate action');
  assert.equal(await page.$$('.task-actions [data-view-action]').then(nodes => nodes.length), 3, 'Refresh, layout and close live in the task header');
  assert(await page.$$eval('.task-actions button', buttons => buttons.every(button => button.getBoundingClientRect().width === 24 && button.querySelector('svg')!.getBoundingClientRect().width === 16)), 'Header actions use conventional compact control and icon sizes');
  assert.equal(await page.$('.task-open[title], .task-open[data-tooltip]'), null, 'Task text must not show a tooltip');
  assert(await page.$eval('.task-details', element => element.textContent === '项目会议 · 第 3 行'), 'Row details contain only heading and line number');
  await page.hover('.task-details');
  assert(await page.$eval('.task-details', element => element.hasAttribute('aria-describedby') === (element.scrollWidth > element.clientWidth + 1)), 'Only truncated details have a tooltip');
  await page.hover('.task-label');
  assert.equal(await page.$('.task-details[aria-describedby]'), null, 'Hovering ordinary task text must not retain a details tooltip');
  await page.click('[data-task-scope-trigger]');
  await page.waitForSelector('.document-view-filter-dropdown-panel:not([hidden])');
  assert(await page.$eval('[data-task-scope-trigger]', element => { const style = getComputedStyle(element); return style.boxShadow === 'none' && style.borderWidth === '0px' && getComputedStyle(element.querySelector('.preview-toolbar-dropdown-value')!).textDecorationThickness === '1px'; }), 'Opening the scope menu keeps plain text and the same underline thickness');
  await page.evaluate(() => { (window as any).__taskPopup = document.querySelector('.document-view-filter-dropdown-panel:not([hidden])'); });
  // A repeated source invalidation must not close or rebuild an open menu.
  fixture.change(a, initial); await first.send({ type: 'docChanged', text: initial, version: fixture.documents.get(a)!.version });
  await page.waitForFunction(() => !document.querySelector('.task-status')?.textContent?.includes('正在索引'));
  assert(await page.evaluate(() => { const popup = (window as any).__taskPopup; return popup?.isConnected && !popup.hidden; }));
  await page.keyboard.press('Escape'); assert(await page.$('.meo-tasks'), 'Escape closes only the open dropdown');
  await page.click('[data-task-status-trigger]'); await page.click('.document-view-filter-dropdown-panel:not([hidden]) [data-value="open"]');
  assert.equal(await page.$$('.task-row').then(nodes => nodes.length), 1);
  await page.click('[data-task-status-trigger]'); await page.click('.document-view-filter-dropdown-panel:not([hidden]) [data-value="all"]');
  await page.click('.task-open');
  await page.waitForFunction(() => !!document.querySelector('[data-document-view-side]') && !(document.querySelector('.editor-wrapper') as HTMLElement)?.inert);
  assert(await page.evaluate(() => (window as any).__viewportTestView().dom.getBoundingClientRect().width > 0), 'Navigation exposes the source alongside tasks');
  await page.evaluate(() => {
    const state = window as any; state.__unchangedTask = document.querySelectorAll('.task-row')[1]; state.__taskMutations = 0;
    state.__taskObserver = new MutationObserver(records => { state.__taskMutations += records.length; });
    state.__taskObserver.observe(state.__unchangedTask, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await page.click('.task-row input[type=checkbox]');
  await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [x] 整理需求'));
  assert(await page.evaluate(() => document.querySelectorAll('.task-row')[1] === (window as any).__unchangedTask), 'Checking one task must retain the other row and its visual state');
  assert(await page.evaluate(() => !(window as any).__unchangedTask.querySelector('input').disabled), 'Unchanged task checkboxes must not turn disabled/gray');
  await page.waitForFunction(() => { const input = document.querySelector<HTMLInputElement>('.task-row input'); return input?.checked && !input.disabled; });
  assert.equal(await page.evaluate(() => { const state = window as any; state.__taskObserver.disconnect(); return state.__taskMutations; }), 0, 'Unchanged rows must not be repainted through transient attribute or text changes');
  await page.evaluate(() => (window as any).__viewportTestView().focus()); await history(page);
  await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [ ] 整理需求'));
  await history(page, true); await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [x] 整理需求'));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('.task-row input')].every(e => !e.disabled && e.checked));
  await page.evaluate(() => document.querySelectorAll<HTMLInputElement>('.task-row input').forEach(e => e.click()));
  await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [ ] 整理需求') && (window as any).__viewportTestText().includes('- [ ] 已确认范围'));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('.task-row input')].every(e => !e.disabled && !e.checked));
  await page.evaluate(() => document.querySelectorAll<HTMLInputElement>('.task-row input').forEach(e => e.click()));
  await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [x] 整理需求') && (window as any).__viewportTestText().includes('- [x] 已确认范围'));
  assert(await page.$eval('.task-error', element => (element as HTMLElement).hidden), 'Rapid changes in one file must queue without stale-edit errors');
  await page.select('[data-task-scope]', 'workspace'); await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 4);
  assert(await page.$eval('.task-file', element => { const style = getComputedStyle(element), list = element.parentElement!; return style.borderLeftWidth === '0px' && element.getBoundingClientRect().width >= list.clientWidth - 1 && style.backgroundColor !== getComputedStyle(list.closest('.meo-tasks')!).backgroundColor; }), 'File headings use a full-width neutral background without an accent edge');
  console.log('Current document history and workspace indexing passed');
  const target = `input[data-task-key^="${b}:"]`;
  await page.click(target);
  // The target stays in the background: requestAnimationFrame may be suspended there.
  await second.page.waitForFunction(() => (window as any).__viewportTestText().includes('- [x] 修复导出'), { polling: 50 });
  await second.page.bringToFront(); await second.page.evaluate(() => (window as any).__viewportTestView().focus()); await history(second.page);
  await second.page.waitForFunction(() => (window as any).__viewportTestText().includes('- [ ] 修复导出'));
  await page.bringToFront();
  await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLInputElement)?.checked, {}, target);
  await page.click(`input[data-task-key^="${c}:"]`); await page.waitForFunction(selector => { const input = document.querySelector<HTMLInputElement>(selector); return input?.checked && !input.disabled; }, {}, `input[data-task-key^="${c}:"]`);
  assert(fixture.documents.get(c)!.text.includes('- [x] native task\r\n')); assert.equal(fixture.counts().nativeEdits, 1);
  console.log('Cross-file history and closed-file edits passed');
  await page.type('[data-task-search]', '修复'); assert.equal(await page.$$('.task-row').then(rows => rows.length), 1);
  await page.click('.task-open');
  await page.click('.task-clear');
  assert(await page.$eval('[data-task-search]', element => (element as HTMLInputElement).value === '' && document.activeElement === element), 'Clear search resets the filter and returns focus to its input');
  await page.screenshot({ path: path.join(out, 'tasks-light.png') });
  await page.click('[data-action="settings"]'); await page.click('.ui-language-button[data-ui-language="en"]');
  await page.waitForFunction(() => document.querySelector('.meo-tasks h2')?.textContent === 'Tasks in');
  await page.click('.editor-appearance-button[data-editor-appearance="dark"]'); await page.click('[data-action="settings"]');
  await page.evaluate(() => document.documentElement.style.setProperty('--meo-user-editor-font-size', '20px'));
  assert(await page.evaluate(() => [...document.querySelectorAll('.task-filter .preview-toolbar-dropdown-value')].every(e => e.scrollWidth <= e.clientWidth + 1)), 'Status and file labels must remain complete at a large body font');
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('.task-open')!).fontSize === getComputedStyle(document.querySelector('.editor-host .cm-content')!).fontSize), 'Task text follows the current body font size');
  await page.evaluate(() => document.documentElement.style.removeProperty('--meo-user-editor-font-size'));
  await page.setViewport({ width: 700, height: 720 }); await page.screenshot({ path: path.join(out, 'tasks-narrow.png') });
  assert(await page.evaluate(() => { const root = document.querySelector('.meo-tasks')!; return root.scrollWidth <= root.clientWidth + 1; }));
  const detail = `input[data-task-key^="${a}:"] + .task-open .task-details`;
  await page.hover(detail);
  await page.waitForFunction(selector => { const element = document.querySelector(selector)!; const hint = document.getElementById(element.getAttribute('aria-describedby') ?? ''); return element.scrollWidth > element.clientWidth && hint?.classList.contains('is-visible') && hint.textContent === element.textContent; }, {}, detail);
  assert(await page.$eval('.task-open', element => { const details = element.querySelector('.task-details')!; return details.getBoundingClientRect().width <= element.getBoundingClientRect().width * .3 + 1; }), 'Secondary details cannot crowd out the task text');
  await page.setViewport({ width: 1200, height: 800 });
  await page.click('[data-mode="source"]'); await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'source');
  await page.select('[data-task-scope]', 'current'); await page.waitForFunction(() => document.querySelectorAll('.task-row').length === 2);
  await page.click('.task-row input'); await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [ ] 整理需求'));
  await page.click('[data-mode="preview"]'); await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'preview');
  await page.waitForFunction(() => !!document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-task-checkbox'), { timeout: 5000 });
  await page.waitForFunction(() => !(document.querySelector('.task-row input') as HTMLInputElement)?.disabled);
  await page.click('.task-row input'); await page.waitForFunction(() => (window as any).__viewportTestText().includes('- [x] 整理需求'));
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-task-checkbox')?.classList.contains('is-done'), { timeout: 4000 }).catch(() => { throw new Error('Preview must reflect a task edit without switching modes'); });
  await page.click('[data-mode="live"]'); await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'live');
  console.log('Source and Preview task edits passed');
  const cold = await editor(c, 'preview'); await cold.page.bringToFront();
  await cold.page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'preview');
  fixture.change(c, '# Changed in another editor\n\n- [ ] Updated native task\n');
  await cold.send({ type: 'docChanged', text: fixture.documents.get(c)!.text, version: fixture.documents.get(c)!.version });
  await cold.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.body.textContent?.includes('Updated native task'), { timeout: 5000 });
  await cold.send(catalog); await cold.page.click('[data-view-id="extras/tasks"]');
  await cold.page.waitForSelector('.task-row'); await cold.page.click('.task-open'); await cold.page.click('.task-row input');
  await cold.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('.meo-export-task-checkbox')?.classList.contains('is-done'), { timeout: 5000 });
  await cold.page.close(); await page.bringToFront();
  const large = '# Large\n\n' + 'ordinary paragraph\n\n'.repeat(40000) + '- [ ] far task\n';
  await page.evaluate(text => { const view = (window as any).__viewportTestView(); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }, large);
  await page.select('[data-task-scope]', 'current');
  await page.waitForFunction(() => document.querySelector('.task-label')?.textContent === 'far task', { timeout: 30000 });
  await page.click('.task-row input'); await page.waitForFunction(() => (window as any).__viewportTestText().endsWith('- [x] far task\n'));
  await page.evaluate(() => (window as any).__viewportTestView().focus()); await history(page);
  await page.waitForFunction(() => (window as any).__viewportTestText().endsWith('- [ ] far task\n'));
  await measureTaskUpdate('large');
  enabled = false; first.connection.refresh(); second.connection.refresh(); await first.send({ type: 'documentViewsChanged', views: [] });
  assert.equal(fixture.counts().watchers, 0); assert.equal(await page.$('.meo-tasks'), null); assert.deepEqual(errors, []);
  console.log('Task overview: real editor current/cross-file edits, undo/redo, closed-file CRLF, filtering, language, narrow layout, large offscreen tasks and disposal passed');
} finally { closes.forEach(close => close()); owner.dispose(); worker.dispose(); await browser.close(); }
