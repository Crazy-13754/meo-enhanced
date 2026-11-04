import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';
import { statisticsCases } from './document-statistics-cases';

const root = path.resolve(import.meta.dir, '..');
const builds = await Promise.all([
  Bun.build({ entrypoints: ['scripts/statistics-selection-test-entry.ts'], target: 'browser', format: 'iife' }),
  Bun.build({ entrypoints: ['webview/src/documentStatisticsWorker.ts'], target: 'browser', format: 'iife' })
]);
for (const build of builds) assert.ok(build.success, build.logs.map(String).join('\n'));
const [entry, worker] = await Promise.all(builds.map(build => build.outputs[0]!.text()));
const css = fs.readFileSync(path.join(root, 'webview/src/styles.css'), 'utf8');
const server = Bun.serve({ port: 0, fetch(request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/entry.js') return new Response(entry, { headers: { 'Content-Type': 'text/javascript' } });
  if (pathname === '/worker.js') return new Response(worker, { headers: { 'Content-Type': 'text/javascript' } });
  if (pathname === '/styles.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
  return new Response('<!doctype html><link rel="stylesheet" href="/styles.css"><style>html,body{margin:0}.cm-editor{height:650px}:root{--vscode-editor-font-size:16px;--vscode-editor-font-family:monospace;--vscode-font-family:Arial}</style><body data-meo-statistics-worker-src="/worker.js"><div id="app"></div><script src="/entry.js"></script>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
} });
const browser = await launchTestBrowser().catch(error => { server.stop(true); throw error; });
const page = await browser.newPage();
const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
await page.setViewport({ width: 1000, height: 700 });
let assertions = 0;
const settle = async (words: number, selected: number, hasSelection: boolean, line?: number) => {
  try {
    await page.waitForFunction(({ words, selected, hasSelection, line }) => {
      const s = (window as any).statistics;
      return s?.words === words && s.selectedWords === selected && s.hasSelection === hasSelection && (line === undefined || s.line === line);
    }, { timeout: 2500 }, { words, selected, hasSelection, line });
  } catch (error) {
    const actual = await page.evaluate(() => ({ stats: (window as any).statistics, ranges: (window as any).editor.readStatisticsSelection(),
      active: document.activeElement?.tagName, selectedCells: document.querySelectorAll('.meo-md-html-table-cell-selected').length }));
    throw new Error(`Expected ${JSON.stringify({words,selected,hasSelection,line})}, got ${JSON.stringify(actual)}`, { cause: error });
  }
  assertions++;
};
const mount = async (cells: readonly (readonly {source: string; words: number}[])[]) => {
  const columns = cells[0]!.length;
  const text = `| ${Array.from({length:columns}, (_,i) => `Header${i}`).join(' | ')} |\n| ${Array(columns).fill('---').join(' | ')} |\n`
    + cells.map(row => `| ${row.map(c => c.source).join(' | ')} |`).join('\n') + '\n\noutside';
  await page.evaluate(text => (window as any).mountStatistics(text), text);
  const total = columns + 1 + cells.flat().reduce((sum, c) => sum + c.words, 0);
  await settle(total, 0, false);
  return total;
};
const position = async (row: number, column: number) => page.$eval(`tbody tr:nth-child(${row + 1}) td:nth-child(${column + 1}) .meo-md-html-table-cell-preview`, e => {
  const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const drag = async (from: [number, number], to: [number, number], total: number, selected: number, hold = false) => {
  await page.keyboard.press('Escape');
  const start = await position(...from), end = await position(...to);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  if (hold) await settle(total, selected, true, to[0] + 3);
  await page.mouse.up();
  await settle(total, selected, true, to[0] + 3);
};
try {
  await page.goto(server.url.href);
  const fixtures = Array.from({ length: Math.ceil(statisticsCases.length / 9) }, (_, offset) =>
    Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => statisticsCases[(offset * 9 + row * 3 + column) % statisticsCases.length]!)));
  fixtures.push(Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => statisticsCases[7]!)));
  for (const cells of process.argv.includes('--interaction-only') ? [] : fixtures) {
    const total = await mount(cells);
    const sum = (r0: number, r1: number, c0: number, c1: number) => cells.slice(r0, r1 + 1).reduce((n, row) => n + row.slice(c0, c1 + 1).reduce((n, c) => n + c.words, 0), 0);
    for (const [from, to] of [[[0,0],[2,2]], [[2,2],[0,0]], [[0,2],[2,0]], [[2,0],[0,2]]] as [[number,number],[number,number]][]) {
      await drag(from, to, total, sum(0,2,0,2), true);
    }
    for (let i=0; i<3; i++) {
      await drag([i,0], [i,2], total, sum(i,i,0,2));
      await drag([i,2], [i,0], total, sum(i,i,0,2));
      await drag([0,i], [2,i], total, sum(0,2,i,i));
      await drag([2,i], [0,i], total, sum(0,2,i,i));
    }
    for (let row=0;row<2;row++) for(let col=0;col<2;col++) {
      await drag([row,col],[row+1,col+1],total,sum(row,row+1,col,col+1));
      await drag([row+1,col+1],[row,col],total,sum(row,row+1,col,col+1));
    }
    await page.keyboard.press('Escape'); await settle(total,0,false);
    console.log('Passed drag combinations:', cells.flat().map(c => c.name).join(', '));
  }
  const cells = [[{source:'hello中文',words:3},{source:'world',words:1}],[{source:'123',words:1},{source:'测试',words:2}]];
  let total = await mount(cells);
  await page.evaluate(() => { const view = (window as any).editor.view;
    view.dispatch({ selection: { anchor: view.state.doc.length - 7, head: view.state.doc.length } }); view.focus(); });
  await settle(total,1,true);
  await drag([0,0],[1,1],total,7);
  await page.keyboard.press('Escape'); await settle(total,0,false);
  await page.click('.cm-line:last-child'); await settle(total,0,false);
  const first = await position(0,0); await page.mouse.click(first.x,first.y);
  await page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement);
  for (const [start,end,expected] of [[0,5,1],[5,7,2],[0,7,3],[2,4,1],[7,7,0]]) {
    await page.evaluate(({start,end}) => (document.activeElement as HTMLTextAreaElement).setSelectionRange(start!,end!),{start,end});
    await settle(total,expected!,start!==end);
  }
  await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).setSelectionRange(0,7));
  await page.keyboard.type('hello world'); total--;
  await settle(total,0,false);
  await drag([0,0],[1,1],total,6);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).editor.view.dispatch({ changes: { from: 0, insert: '# Inserted\n\n' } }));
  total++;
  await settle(total,0,false);
  const start=await position(0,0),end=await position(1,1);
  await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(end.x,end.y,{steps:6}); await page.mouse.up();
  await settle(total,6,true,6);
  for (const large of [false, true]) for (const transition of ['outer-selection', 'replacement', 'source', 'offscreen'] as const) {
    const prefix = 'outer selection witness\n\n';
    const table = '| A | B |\n| --- | --- |\n| hello | world |\n| good | day |\n';
    const tailCount = large ? 9000 : 150;
    const suffix = '\n' + 'tail\n'.repeat(tailCount);
    await page.evaluate(text => (window as any).mountStatistics(text), prefix + table + suffix);
    await settle(9 + tailCount, 0, false);
    const band = await page.evaluate(() => (window as any).statisticsPresentation());
    assert.equal(band !== null, large, 'table disposal must cover both actual presentation strategies');
    if (large) assert.ok(band.to < prefix.length + table.length + suffix.length, 'large fixture must retain a bounded presentation band');
    const oldTable = await page.$('.meo-md-html-table');
    assert.ok(oldTable);
    const first = await position(0, 0);
    if (transition === 'outer-selection') {
      const last = await position(1, 1);
      await page.mouse.move(first.x, first.y); await page.mouse.down();
      await page.mouse.move(last.x, last.y, { steps: 6 }); await page.mouse.up();
      await settle(9 + tailCount, 4, true, 6);
    } else {
      await page.mouse.click(first.x, first.y);
      await page.waitForFunction(() => document.activeElement instanceof HTMLTextAreaElement);
      await page.evaluate(() => (document.activeElement as HTMLTextAreaElement).setSelectionRange(0, 5));
      await settle(9 + tailCount, 1, true, 5);
      assert.equal(await page.evaluate(() => (window as any).selectionMenu.visible), true, 'cell text selection must expose its menu before disposal');
    }
    if (transition === 'source') {
      await page.evaluate(() => (window as any).editor.setMode('source'));
      await page.waitForFunction(() => (window as any).editor.view.dom.classList.contains('meo-mode-source'));
    } else if (transition === 'offscreen') {
      // A focused native cell owns its mounted input. Finish that interaction
      // with a real outer-text selection before virtualizing the idle table.
      await page.click('.cm-line'); await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowRight');
      await page.keyboard.up('Shift');
      await page.waitForFunction(() => {
        const editor = (window as any).editor, selection = editor.view.state.selection.main;
        return editor.view.hasFocus && selection.from === 0 && selection.to === 5;
      });
      await page.mouse.move(300, 500); await page.mouse.wheel({ deltaY: 30000 });
      await page.waitForFunction(() => !document.querySelector('.meo-md-html-table'));
      assert.ok(await page.evaluate(() => (window as any).editor.view.scrollDOM.scrollTop) > 650, 'offscreen disposal requires actual document scroll progress');
    } else {
      await page.evaluate(({ from, to, selected }) => (window as any).editor.view.dispatch({
        changes: { from, to, insert: 'replacement\n' }, ...(selected ? { selection: { anchor: 0, head: 5 } } : {})
      }), { from: prefix.length, to: prefix.length + table.length, selected: transition === 'outer-selection' });
    }
    const replaced = transition === 'outer-selection' || transition === 'replacement';
    await settle((replaced ? 4 : 9) + tailCount, transition === 'replacement' ? 0 : 1, transition !== 'replacement');
    assert.equal(await page.evaluate(() => (window as any).editor.getText()), prefix + (replaced ? 'replacement\n' : table) + suffix);
    assert.equal(await page.$('.meo-md-html-table'), null, 'the selected table must actually be disposed');
    assert.equal(await oldTable.evaluate(element => element.isConnected), false, 'the old widget must leave its document');
    await oldTable.dispose();
    const selection = await page.evaluate(() => (window as any).selectionMenu);
    assert.equal(selection.visible, transition !== 'replacement', 'the menu model must follow the current selection owner');
    if (transition === 'outer-selection') assert.deepEqual([selection.from, selection.to], [0, 5]);
    if (transition === 'source') {
      const current = await page.evaluate(() => {
        const view = (window as any).editor.view, range = view.state.selection.main;
        return { from: range.from, to: range.to, coords: view.coordsAtPos(range.from) };
      });
      assert.deepEqual([selection.from, selection.to], [current.from, current.to], 'Source keeps the valid native-cell text range');
      assert.ok(current.coords && Math.abs(selection.anchorY - current.coords.top) <= 1, 'Source menu uses its current reading geometry');
    }
    if (transition === 'offscreen') assert.deepEqual([selection.from, selection.to], [0, 5], 'unmount must publish the surviving outer range, not the retired cell range');
    if (transition === 'offscreen') {
      await page.mouse.wheel({ deltaY: -30000 });
      await page.waitForSelector('.meo-md-html-table');
      await settle(9 + tailCount, 1, true, 1);
      assert.deepEqual(await page.evaluate(() => {
        const selection = (window as any).selectionMenu;
        return [selection.visible, selection.from, selection.to];
      }), [true, 0, 5], 'remount retains the current outer range rather than the disposed cell range');
    }
    assert.deepEqual(errors, [], 'retiring table controls must not read layout during an editor update');
    console.log(`Table disposal preserved current selection and statistics (${large ? 'bounded' : 'ordinary'}/${transition})`);
  }
  assert.deepEqual(errors, []);
  console.log(`Document statistics drag matrix passed (${assertions} assertions, ${statisticsCases.length} content cases)`);
} finally { await closeTestBrowser(browser); server.stop(true); }
