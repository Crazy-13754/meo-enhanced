import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';
import { encodeMarkdownPath } from '../src/foundation/linkDestination';

const build = await Bun.build({ entrypoints: ['scripts/test-editing-features-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const browser = await launchTestBrowser(), page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
const longName = '项目规划与实现细节'.repeat(10) + ' 50%.md';
const longPath = 'docs/' + '很长的项目目录/'.repeat(8) + longName;
let phase = 'setup';
const prepare = async (text: string, cursor: number, mode = 'source', appearance = 'light', language = 'zh-CN', documentSuggestions = true, fontSize = 13) => {
  await page.evaluate(({ text, cursor, mode, appearance, language, documentSuggestions, fontSize, longName, longPath }) => {
    const g = window as any; g.editor?.destroy(); g.requests = []; g.refreshed = false;
    document.documentElement.dataset.editorAppearance = appearance;
    document.documentElement.lang = language;
    g.EditingFeaturesHarness.applyUiTheme(appearance, true);
    g.editor = g.EditingFeaturesHarness.createEditor({ parent: document.getElementById('app')!, text, initialMode: mode, uiLanguage: language,
      initialInputAssistance: { ...g.inputDefaults, documentSuggestions, emoji: true }, onApplyChanges() {},
      requestLinkCandidates: async (request: any) => {
        g.requests.push(request);
        if (request.kind === 'documents') {
          const rows = [{ label: longName, insert: 'project-plan|项目规划', detail: longPath }, { label: g.refreshed ? 'Short refreshed' : 'Short', insert: 'short', detail: 'short.md' }];
          return g.refreshed ? rows.reverse() : rows;
        }
        if (request.kind === 'headings') return [{ label: 'Overview', insert: 'overview', anchor: 'overview', detail: 'docs/guide.md' }];
        if (request.query.startsWith('/docs/') || request.query.startsWith("/docs'backup/")) return [{ label: longName, insert: longName, detail: longPath, kind: 'file' }, { label: 'Short.md', insert: 'Short.md', detail: 'docs/Short.md', kind: 'file' }];
        return [{ label: 'docs/', insert: 'docs/', detail: 'docs', kind: 'directory' }];
      } });
    g.editor.view.contentDOM.style.fontSize = fontSize + 'px';
    g.editor.view.dispatch({ selection: { anchor: cursor } }); g.editor.view.focus();
  }, { text, cursor, mode, appearance, language, documentSuggestions, fontSize, longName, longPath });
};
const visible = () => page.waitForSelector('.meo-input-suggestions:not([hidden])', { timeout: 4000 });
const tooltip = () => page.waitForSelector('.meo-tooltip.is-visible', { timeout: 3000 });
const closed = () => page.waitForFunction(() => !document.querySelector('.meo-input-suggestions:not([hidden])') && !document.querySelector('.meo-tooltip.is-visible'), { timeout: 2000 });
const text = () => page.evaluate(() => (window as any).editor.getText());
const tooltipText = () => page.$eval('.meo-tooltip.is-visible', element => element.textContent);
const menuWidth = () => page.$eval('.meo-input-suggestions:not([hidden])', element => element.getBoundingClientRect().width);
const nativeCaret = (head?: number) => page.evaluate(head => {
  const input = document.activeElement as HTMLTextAreaElement, bounds = input.getBoundingClientRect(), style = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const property of ['box-sizing', 'padding', 'border', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 'text-align', 'text-indent', 'tab-size'])
    mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, { position: 'fixed', left: '0', top: '0', width: bounds.width + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word', visibility: 'hidden' });
  const node = document.createTextNode(input.value); mirror.append(node); document.body.append(mirror);
  const position = head ?? input.selectionStart, range = document.createRange();
  range.setStart(node, position - 1); range.setEnd(node, position);
  const character = range.getBoundingClientRect(), box = mirror.getBoundingClientRect();
  const result = { x: bounds.left + character.right - box.left - input.scrollLeft - 1,
    y: bounds.top + (character.top + character.bottom) / 2 - box.top - input.scrollTop, head: position };
  mirror.remove(); return result;
}, head);
try {
  await page.setViewport({ width: 1000, height: 720 });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}#other-focus{position:fixed;right:8px;top:8px;z-index:1000}</style><div id="app"></div><button id="other-focus">Other field</button>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addScriptTag({ content: await build.outputs[0].text() });
  await page.evaluate(() => { (window as any).inputDefaults = { selectionToolbar: true, wrapSelection: true, pairMode: 'smart', skipMode: 'smart', deleteMode: 'smart', lists: true, convertTables: true, pasteUrl: true, pasteHtml: false, documentSuggestions: true, slash: true, slashPreferAbove: false, emoji: false }; });
  await page.mouse.move(2, 2);
  for (const mode of ['source', 'live']) for (const [appearance, language] of [['light', 'zh-CN'], ['dark', 'en']]) {
    phase = mode + '/' + appearance + '/' + language;
    await prepare('[File](/)', 8, mode, appearance, language);
    await visible(); assert.equal(await page.$('.meo-tooltip.is-visible'), null, 'unclipped directory has no hint');
    assert.equal(await menuWidth(), 260, 'normal-size directory menu is compact');
    assert.equal(await page.$('.meo-input-suggestions .meo-input-suggestion-detail'), null, 'directory candidates do not repeat their path');
    await page.keyboard.press('Tab'); await visible();
    await page.waitForFunction(() => (window as any).requests.some((request: any) => request.query === '/docs/'));
    await tooltip();
    assert.equal(await tooltipText(), longName, 'path hint reveals only the clipped filename without hover');
    assert.equal(await menuWidth(), 260, 'directory chaining does not change width');
    assert.equal(await page.$('.meo-slash-suggestions:not([hidden])'), null, 'directory slash does not become a command');
    assert.equal(await page.evaluate(() => document.activeElement === (window as any).editor.view.contentDOM), true, 'hint retains editing focus');
    const geometry = await page.evaluate(() => {
      const hint = document.querySelector<HTMLElement>('.meo-tooltip.is-visible')!, menu = document.querySelector<HTMLElement>('.meo-input-suggestions:not([hidden])')!;
      const a = hint.getBoundingClientRect(), b = menu.getBoundingClientRect();
      return { outside: a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top, inside: a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight, side: hint.dataset.side };
    });
    assert.equal(geometry.outside, true); assert.equal(geometry.inside, true);
    assert.ok(['left', 'right'].includes(geometry.side!));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => !document.querySelector('.meo-tooltip.is-visible'));
    assert.equal(await menuWidth(), 260, 'short selection does not shrink the menu');
    await page.keyboard.press('ArrowUp'); await tooltip();
    await page.keyboard.press('Enter'); await closed();
    assert.equal(await text(), '[File](/docs/' + encodeMarkdownPath(longName) + ')');
    await page.keyboard.type('#'); await visible(); await page.keyboard.press('Tab'); await closed();
    assert.ok((await text()).endsWith('#overview)'));
    await prepare('[[pp]]', 4, mode, appearance, language); await visible(); await tooltip();
    assert.equal(await menuWidth(), 360, 'Wiki search keeps the wider two-line menu');
    assert.equal(await tooltipText(), longName + '\n' + longPath, 'Wiki search retains full name and path');
    await page.keyboard.press('Enter'); await closed();
    assert.equal(await text(), '[[project-plan|项目规划]]');
    await page.keyboard.type('#'); await visible();
    assert.equal(await page.evaluate(() => (window as any).requests.at(-1).wiki), true);
    await page.keyboard.press('Enter'); await closed();
    assert.equal(await text(), '[[project-plan#overview|项目规划]]', 'heading insertion preserves alias suffix');
    await prepare('[[pp]]', 4, mode, appearance, language); await visible(); await tooltip();
    await page.keyboard.press('Escape'); await closed();
    await page.evaluate(() => (window as any).editor.refreshInputSuggestions());
    await new Promise(resolve => setTimeout(resolve, 220)); await closed();
    await prepare('[File](/)', 8, mode, appearance, language, false);
    await page.keyboard.type('b'); await closed(); assert.equal(await page.$('.meo-slash-suggestions:not([hidden])'), null);
  }
  for (const mode of ['source', 'live']) for (const closing of ['', ')']) {
    phase = 'resume partial path ' + mode + '/' + closing;
    await prepare('[File](/' + closing, 8, mode); await visible(); await page.keyboard.press('Tab'); await visible();
    const caret = await page.evaluate(() => {
      const view = (window as any).editor.view, coords = view.coordsAtPos(view.state.selection.main.head, -1)!;
      // Stay within the final slash, before Live's adjacent clear-address button.
      return { x: coords.left - 1, y: (coords.top + coords.bottom) / 2, head: view.state.selection.main.head };
    });
    await page.keyboard.press('Escape'); await closed();
    await page.click('#other-focus'); await closed();
    await page.mouse.click(caret.x, caret.y); await visible();
    assert.equal(await page.evaluate(() => (window as any).editor.view.state.selection.main.head), caret.head, 'clicking the same caret resumes without moving it');
    assert.equal(await page.evaluate(() => (window as any).requests.at(-1).query), '/docs/', 'resume uses the already chosen directory');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await closed();
    assert.equal(await text(), '[File](/docs/Short.md' + closing, 'resumed selection completes the existing path');
  }
  for (const mode of ['source', 'live']) {
    phase = 'IME quoted directory ' + mode;
    const prefix = "[File](/docs'backup/no";
    await prepare(prefix + ')', prefix.length, mode); await visible();
    const ime = await page.createCDPSession();
    await ime.send('Input.imeSetComposition', { text: "'te", selectionStart: 3, selectionEnd: 3 });
    await page.waitForFunction(() => (window as any).requests.at(-1).query === "/docs'backup/note");
    assert.equal(await text(), prefix + "'te)", 'preedit filtering leaves the literal document unchanged');
    assert.equal(await page.$eval('.meo-input-suggestion[aria-selected="true"]', row => row.getAttribute('aria-disabled')), 'true');
    await ime.send('Input.insertText', { text: 'te' });
    await page.waitForFunction(() => document.querySelector('.meo-input-suggestion[aria-selected="true"]')?.getAttribute('aria-disabled') === 'false');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await closed();
    assert.equal(await text(), "[File](/docs'backup/Short.md)", 'completion retains the quoted directory after IME commit');
    await ime.detach();
  }
  await prepare('[File](/docs/项目OLD.md#keep "title")', '[File](/docs/项目'.length);
  await visible(); await page.keyboard.press('Enter'); await closed();
  assert.equal(await text(), '[File](/docs/' + encodeMarkdownPath(longName) + '#keep "title")', 'replace current segment suffix, retain fragment/title');
  await prepare('[[pp\n\nNext paragraph', 4); await visible(); await page.keyboard.press('Enter'); await closed();
  assert.equal(await text(), '[[project-plan|项目规划\n\nNext paragraph', 'unclosed Wiki completion retains following paragraphs');
  await prepare('[[pp]]', 4); await visible(); await page.keyboard.press('ArrowDown');
  await page.evaluate(() => { (window as any).refreshed = true; (window as any).editor.refreshInputSuggestions(); });
  await page.waitForFunction(() => document.querySelector('.meo-input-suggestions:not([hidden]) [aria-selected="true"] .meo-suggestion-label')?.textContent === 'Short refreshed');
  assert.equal(await page.$eval('.meo-input-suggestions [aria-selected="true"]', element => (element as HTMLElement).dataset.suggestionIndex), '0', 'metadata reordering preserves selected file identity');
  assert.equal(await page.$('.meo-tooltip.is-visible'), null, 'renamed short item stays without a hint');
  await page.keyboard.press('Escape'); await closed();
  phase = 'source table alias';
  const sourceTable = '| A | B |\n| --- | --- |\n| [[pp]] | x |';
  await prepare(sourceTable, sourceTable.indexOf('[[pp]]') + 4); await visible(); await page.keyboard.press('Enter'); await closed();
  assert.equal(await text(), sourceTable.replace('[[pp]]', '[[project-plan\\|项目规划]]'));
  assert.equal(await page.evaluate(() => (window as any).EditingFeaturesHarness.parseMarkdownTable((window as any).editor.getText()).cells[1].length), 2);
  for (const value of ['[File](/)', '[[pp]]', '[[/]]']) {
    phase = 'native ' + value;
    const table = '| A | B |\n| --- | --- |\n| ' + value + ' | x |';
    await prepare(table, table.length, 'live');
    await page.waitForSelector('tbody textarea');
    const cursor = value.startsWith('[[') ? value.indexOf(']]') : value.indexOf(')');
    await page.evaluate(cursor => { const input = document.querySelector<HTMLTextAreaElement>('tbody textarea')!; input.focus(); input.setSelectionRange(cursor - 1, cursor); }, cursor);
    await page.keyboard.type(value[cursor - 1]);
    await visible(); assert.equal(await page.$('.meo-slash-suggestions:not([hidden])'), null, 'table Wiki/path ownership excludes slash commands');
    if (value.startsWith('[[') && value !== '[[/]]') {
      await tooltip(); await page.keyboard.press('Enter'); await closed();
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).value), '[[project-plan\\|项目规划]]');
      assert.equal(await page.evaluate(() => (window as any).EditingFeaturesHarness.parseMarkdownTable((window as any).editor.getTextForSave()).cells[1].length), 2, 'alias separator keeps the table column count');
    } else {
      await page.keyboard.press('Tab'); await visible(); await tooltip();
      if (value === '[File](/)') {
        phase = 'resume native partial path';
        const caret = await nativeCaret();
        await page.keyboard.press('Escape'); await closed(); await page.click('#other-focus'); await closed();
        // Inactive table cells show rendered Markdown. Enter cell editing, then click the address.
        await page.click('tbody td .meo-md-html-table-cell-preview .meo-md-link span');
        await page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement);
        const restored = await nativeCaret(caret.head);
        await page.mouse.click(restored.x, restored.y);
        assert.equal(await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).selectionStart), caret.head, 'native same-caret click resumes');
        await visible();
        assert.equal(await page.evaluate(() => (window as any).requests.at(-1).query), '/docs/');
      }
      await page.keyboard.press('Enter'); await closed();
      assert.ok(await page.evaluate(() => document.activeElement instanceof HTMLTextAreaElement && document.activeElement.isConnected));
      assert.ok((await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).value)).includes(value.startsWith('[[') ? longName : encodeMarkdownPath(longName)), 'native input receives chosen file');
      await page.evaluate(() => (window as any).editor.refreshInputSuggestions());
      await new Promise(resolve => setTimeout(resolve, 220)); await closed();
    }
  }
  // Every candidate family uses the same selected-row truncation behavior.
  for (const fontSize of [17, 29]) {
    phase = 'large path font ' + fontSize;
    await prepare('[File](/)', 8, 'source', 'light', 'zh-CN', true, fontSize); await visible();
    assert.equal(await menuWidth(), 300, 'large editor fonts widen paths to the bounded maximum');
    assert.equal(await page.$('.meo-input-suggestions .meo-input-suggestion-detail'), null);
    await page.keyboard.press('Tab'); await visible(); await tooltip();
    assert.equal(await menuWidth(), 300);
    await page.keyboard.press('Escape'); await closed();
  }
  await page.setViewport({ width: 220, height: 720 });
  await prepare('[File](/)', 8); await visible();
  const narrowPath = await page.$eval('.meo-input-suggestions:not([hidden])', element => {
    const bounds = element.getBoundingClientRect(); return { width: bounds.width, left: bounds.left, right: bounds.right };
  });
  assert.ok(narrowPath.width < 260 && narrowPath.left >= 8 && narrowPath.right <= 212, 'narrow paths fit the viewport');
  await page.keyboard.press('Escape'); await closed();
  await page.setViewport({ width: 520, height: 720 });
  for (const source of ['/comment', ':thumbsdown', '# ' + 'Long heading '.repeat(14) + '\n\n[Go](#']) {
    phase = 'candidate family ' + source.slice(0, 20);
    await prepare(source.startsWith('/') ? '' : source, source.startsWith('/') ? 0 : source.length);
    if (source.startsWith('/')) await page.keyboard.type(source);
    await visible();
    await page.evaluate(() => { const popup = document.querySelector<HTMLElement>('.meo-input-suggestions')!; popup.style.minWidth = '0'; popup.style.width = '100px'; window.dispatchEvent(new Event('resize')); });
    await tooltip(); assert.ok((await tooltipText())!.length > 0);
    await page.keyboard.press('Escape'); await closed();
  }
  await page.setViewport({ width: 1000, height: 720 });
  await prepare('[[pp]]', 4); await visible(); await tooltip();
  mkdirSync('artifacts/link-candidates', { recursive: true });
  await page.screenshot({ path: 'artifacts/link-candidates/selected-fulltext-light.png' });
  await prepare('[[pp]]', 4, 'source', 'dark', 'en'); await visible(); await tooltip();
  await page.screenshot({ path: 'artifacts/link-candidates/selected-fulltext-dark.png' });
  await page.evaluate(() => (window as any).editor.destroy());
  assert.equal(await page.$('.meo-tooltip'), null, 'owner destruction disposes selected hint');
  assert.deepEqual(errors, []);
  console.log('Link candidate production contracts: directory chaining, resumed selection, quoted-directory IME, segment/alias preservation, native tables, keyboard full text, all candidate families, themes/languages, dismissal and disposal passed');
} catch (error) {
  console.error('Candidate failure:', phase, await page.evaluate(() => ({ active: document.activeElement?.tagName, value: (document.activeElement as HTMLTextAreaElement)?.value,
    menu: document.querySelector('.meo-input-suggestions:not([hidden])')?.className, tooltip: document.querySelector('.meo-tooltip.is-visible')?.textContent }))); throw error;
} finally { await closeTestBrowser(browser); }
