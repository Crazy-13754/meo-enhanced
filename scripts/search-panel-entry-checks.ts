import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { assessLargeDocument } from '../src/foundation/largeDocument';

/** Search entry uses the real Webview shortcuts, selection owners and panel. */
export async function checkSearchPanelEntry(page: Page) {
  const find = '.find-panel .find-input';
  const firstCell = 'tbody tr:first-child td:first-child';
  const close = async () => {
    if (await page.$('.find-panel.is-visible')) await page.click('.find-close-button');
  };
  const open = async () => {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyF'); await page.keyboard.up('Control');
    await page.waitForSelector('.find-panel.is-visible');
  };
  const query = () => page.$eval(find, input => (input as HTMLInputElement).value);
  const body = async (selected = true) => {
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLElement>('.editor-host .cm-line')]
      .find(line => line.textContent === 'body-selected')!);
    await (handle.asElement()!).click(); await handle.dispose();
    await page.keyboard.press('Home');
    if (selected) { await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift'); }
  };
  const fill = async (value: string) => {
    await page.click(find); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value) await page.keyboard.type(value);
  };
  for (const large of [false, true]) {
    await close();
    await page.click('[data-mode="live"]');
    await page.waitForSelector('.editor-host .meo-mode-live');
    const text = 'body-selected\n\n| A | B |\n| --- | --- |\n| table-selected | second-cell |\n\nother body\n\n  spaces  '
      + (large ? '\n\n' + 'padding text\n'.repeat(8100) : '');
    assert.equal(assessLargeDocument(text).boundedEditorWork, large);
    await page.evaluate(text => {
      const view = (window as any).__viewportTestView();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    }, text);
    await page.waitForFunction(large => (window as any).__viewportTestLargeBudget() === large, {}, large);
    await page.waitForSelector(firstCell + ' textarea');
    const label = large ? 'optimized' : 'ordinary';
    // Leave a native range in the cell, then establish a newer body selection.
    await page.click(firstCell + ' .meo-md-html-table-cell-preview');
    await page.$eval(firstCell + ' textarea', (input: HTMLTextAreaElement) => input.setSelectionRange(0, input.value.length));
    await body();
    const stale = await page.$eval(firstCell + ' textarea', (input: HTMLTextAreaElement) => input.selectionEnd > input.selectionStart);
    assert(stale, `${label}/fixture must contain an unfocused native range`);
    await page.evaluate(() => {
      const query = Element.prototype.querySelectorAll;
      (window as any).__searchCellScans = 0;
      (window as any).__searchQuerySelectorAll = query;
      Element.prototype.querySelectorAll = function(selector: string) {
        if (selector === '.meo-md-html-table textarea') (window as any).__searchCellScans++;
        return query.call(this, selector);
      } as typeof query;
    });
    await open();
    const scans = await page.evaluate(() => {
      Element.prototype.querySelectorAll = (window as any).__searchQuerySelectorAll;
      return (window as any).__searchCellScans;
    });
    assert.equal(await query(), 'body-selected', `${label}/body selection wins over stale cell range`);
    assert.equal(scans, 0, `${label}/search entry does not scan every native cell`);
    if (process.env.MEO_TEST_SCREENSHOTS && !large) {
      fs.mkdirSync(process.env.MEO_TEST_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.MEO_TEST_SCREENSHOTS, 'search-entry-body.png') });
    }
    await close();

    for (const previous of ['', 'old-query']) for (const selected of [false, true]) {
      await body(false); await open(); await fill(previous); await close();
      await body(selected); await open();
      assert.equal(await query(), selected ? 'body-selected' : previous, `${label}/selection=${selected}/previous=${previous}`);
      const focused = await page.$eval(find, (input: HTMLInputElement) => ({ active: document.activeElement === input,
        start: input.selectionStart, end: input.selectionEnd, length: input.value.length }));
      assert(focused.active && focused.start === 0 && focused.end === focused.length, `${label}/open focuses and selects the query`);
      await close();
    }

    await body(false); await open(); await fill('preserved');
    await open(); assert.equal(await query(), 'preserved', `${label}/Ctrl+F in search does not reuse the body range`);
    await body();
    assert.equal(await query(), 'preserved', `${label}/selection alone does not change the query`);
    await open();
    assert.equal(await query(), 'body-selected', `${label}/explicit search while visible accepts a new body selection`);
    await page.click(firstCell + ' .meo-md-html-table-cell-preview');
    await page.$eval(firstCell + ' textarea', (input: HTMLTextAreaElement) => input.setSelectionRange(6, input.value.length));
    await open(); assert.equal(await query(), 'selected', `${label}/visible panel accepts current cell selection`);
    await close();
    // Borrowing focus through the toolbar must still use the accepted cell.
    await page.click(firstCell + ' textarea');
    await page.$eval(firstCell + ' textarea', (input: HTMLTextAreaElement) => input.setSelectionRange(0, 5));
    await page.click('[data-action="find"]');
    assert.equal(await query(), 'table', `${label}/toolbar retains the active native selection`);
    await close(); await body(false); await open(); await fill('selected');
    await close();
    await page.click(firstCell + ' textarea');
    await page.$eval(firstCell + ' textarea', (input: HTMLTextAreaElement) => input.setSelectionRange(0, 0));
    await open();
    assert.equal(await query(), 'selected', `${label}/empty cell selection cannot reuse a suspended body range`);

    await page.$eval('.find-replace-row .find-input', (input: HTMLInputElement) => { input.value = 'replacement'; });
    await close(); await body(false); await open();
    assert.equal(await query(), 'selected', `${label}/close retains query`);
    assert.equal(await page.$eval('.find-replace-row .find-input', input => (input as HTMLInputElement).value), 'replacement', `${label}/close retains replacement`);
    // Multi-line seeds cannot be silently flattened by the single-line input.
    await body(false);
    await page.evaluate(() => {
      const view = (window as any).__viewportTestView(); view.dispatch({ selection: { anchor: 0, head: 'body-selected\n\n'.length } });
    });
    await open(); assert.equal(await query(), 'selected', `${label}/multiline selection leaves query intact`);
    await body(false);
    await page.evaluate(() => {
      const view = (window as any).__viewportTestView();
      const from = view.state.doc.toString().indexOf('  spaces  ');
      view.dispatch({ selection: { anchor: from, head: from + 2 } });
    });
    await open(); assert.equal(await query(), '  ', `${label}/spaces are literal search text`);
    await fill('preserved');
    const beforeMode = await page.evaluate(() => (window as any).__viewportTestView().state.doc.toString());
    await page.click('[data-mode="source"]');
    await page.waitForSelector('.editor-host .meo-mode-source');
    assert.equal(await query(), 'preserved', `${label}/mode refresh retains query`);
    await close(); await body(); await open();
    assert.equal(await query(), 'body-selected', `${label}/Source uses the current document selection`);
    assert.equal(await page.evaluate(() => (window as any).__viewportTestView().state.doc.toString()), beforeMode, `${label}/search never edits source`);
    await close();
    console.log(`Search entry selection, query retention and mode continuity passed (${label}, actual derived-work budget)`);
  }
}
