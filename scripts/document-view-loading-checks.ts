import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'puppeteer-core';

/** Hold real renderer assets/worker replies to exercise the host's loading lifecycle. */
export async function checkDocumentViewLoading(page: Page, out: string, holdAssets: () => () => void) {
  const loading = '.document-view-loading';
  const visible = `${loading}:not([hidden])`;
  const ready = () => page.waitForSelector('[data-view-action="fit"]:not(:disabled)');
  const language = await page.$eval('html', e => e.lang);
  const release = holdAssets();
  const started = Date.now();
  await page.click('.mm-view-entry');
  assert(await page.$eval(loading, e => (e as HTMLElement).hidden), 'Fast activation starts with a quiet window');
  await page.waitForSelector(visible);
  assert(Date.now() - started >= 180, 'Loading waits for the shared 200ms quiet window');
  assert.equal(await page.$eval('.mm-view-panel', e => e.getAttribute('aria-busy')), 'true');
  assert.equal(await page.$eval('.mm-view-canvas', e => (e as HTMLElement).inert), true);
  const styles = await page.evaluate(() => {
    const map = getComputedStyle(document.querySelector('.document-view-loading-spinner')!);
    const editor = getComputedStyle(document.querySelector('.editor-loading-spinner')!);
    return { map: [map.width, map.height, map.borderTopColor, map.animationName], editor: [editor.width, editor.height, editor.borderTopColor, editor.animationName] };
  });
  assert.deepEqual(styles.map, styles.editor, 'Shared spinner geometry, color and animation');
  await page.click('[data-action="settings"]');
  const changed = language.startsWith('zh') ? 'en' : 'zh-CN';
  await page.click(`.ui-language-button[data-ui-language="${changed}"]`);
  assert.equal(await page.$eval(loading, e => e.textContent), changed === 'en' ? 'Loading Mind map…' : '正在加载思维导图…');
  await page.click(`.ui-language-button[data-ui-language="${language}"]`);
  await page.click('[data-action="settings"]');
  await page.screenshot({ path: path.join(out, `loading-${language}.png`) });
  release(); await ready();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.document-view-loading')!.hidden);
  assert.equal(await page.$eval('.mm-view-canvas', e => (e as HTMLElement).inert), false);

  // Hold an actual parser request while an already-painted map updates.
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    let send: (() => void) | undefined;
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) { send = () => original.apply(this, args); };
    (window as any).__releaseMapUpdate = () => { Worker.prototype.postMessage = original; send?.(); };
    (window as any).__hasMapUpdate = () => !!send;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'docChanged', version: 1001, text: '# Changed\n- Updated item' } }));
  });
  await page.waitForFunction(() => (window as any).__hasMapUpdate());
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  assert(await page.$eval(loading, e => (e as HTMLElement).hidden), 'Background edits never start a new loading cover');
  assert.equal(await page.$eval('.meo-map-status', e => e.textContent), '', 'Companion does not duplicate host loading feedback');
  assert(await page.$('.meo-markmap g.markmap-node'), 'Previous map stays painted while parsing');
  await page.evaluate(() => (window as any).__releaseMapUpdate());
  await ready();
  await page.waitForFunction(() => document.querySelector('.meo-markmap')?.textContent?.includes('Updated item'));
  await page.click('[data-view-action="close"]');

  const releaseCanceled = holdAssets();
  await page.click('.mm-view-entry'); await page.waitForSelector(visible);
  await page.click('[data-view-action="close"]');
  releaseCanceled();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
  assert(await page.$eval('.mm-view-panel', e => (e as HTMLElement).hidden), 'Closing during loading stays closed');
  assert(await page.$eval(loading, e => (e as HTMLElement).hidden));
  assert.equal(await page.$('.meo-markmap'), null, 'Late assets do not resurrect a disposed map');
  await page.click('.mm-view-entry'); await ready();
  assert(await page.$eval(loading, e => (e as HTMLElement).hidden), 'Opening again works after cancellation');
  await page.click('[data-view-action="close"]');
}
