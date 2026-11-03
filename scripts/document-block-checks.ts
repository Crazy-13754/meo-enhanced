import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

export async function checkDocumentBlocks(page: Page, out: string) {
  const text = '# Embedded map\n\n```markmap\n# Trip\n## Travel\n- Train\n- Bus\n## Visit\n- Museum\n- Park\n```\n\nEnd.\n';
  await page.evaluate(text => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
  }, text);
  const waitInline = () => page.waitForFunction(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const root = doc.querySelector('.meo-contributed-block')?.shadowRoot;
    const buttons = root?.querySelectorAll<HTMLButtonElement>('button');
    return root?.querySelector('g.markmap-node') && buttons?.length && !buttons[buttons.length - 1].disabled;
  });
  const full = () => page.evaluate(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const buttons = doc.querySelector('.meo-contributed-block')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('button');
    buttons[buttons.length - 1].click();
  });
  const waitFull = async () => {
    try { await page.waitForFunction(() => document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')?.shadowRoot?.querySelectorAll('g.markmap-node').length
      && document.querySelectorAll('.meo-mermaid-fullscreen-scrim .meo-visual-control-btn').length === 4); }
    catch (error) {
      console.log(await page.evaluate(() => ({ full: document.querySelector('.meo-mermaid-fullscreen-scrim')?.outerHTML, inline: document.querySelector('.editor-host .meo-contributed-block')?.shadowRoot?.innerHTML.slice(-2500), text: (window as any).__viewportTestText() })));
      await page.screenshot({ path: out + '/embedded-map-failure.png' }); throw error;
    }
  };
  const nodeCount = () => page.evaluate(() => document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelectorAll('g.markmap-node').length);
  try { await waitInline(); } catch (error) {
    console.log(await page.evaluate(() => ({ host: document.querySelector('.editor-host')?.innerHTML.slice(0,16000), map: document.querySelector('.meo-contributed-block')?.shadowRoot?.innerHTML.slice(-1500) })));
    await page.screenshot({ path: out + '/embedded-map-failure.png' }); throw error;
  }
  assert.equal(await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-content')!.hasAttribute('inert')), true);
  await full(); await waitFull(); const initial = await nodeCount();
  await page.evaluate(() => {
    const root = document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!;
    const travel = [...root.querySelectorAll('g.markmap-node')].find(node => node.textContent?.includes('Travel'))!;
    travel.querySelector('circle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction((count) => document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelectorAll('g.markmap-node').length < count, {}, initial);
  const folded = await nodeCount();
  await page.click('.meo-mermaid-fullscreen-scrim [data-action="zoom-in"]');
  await page.waitForFunction(() => (document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('svg.meo-markmap') as any).__zoom.k > 2.1);
  const zoomed = await page.evaluate(() => (document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('svg.meo-markmap') as any).__zoom.k);
  await page.keyboard.press('Escape'); await full(); await waitFull();
  assert.equal(await nodeCount(), folded, 'Fullscreen restores local folds');
  assert.notEqual(await page.evaluate(() => (document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('svg.meo-markmap') as any).__zoom.k), zoomed, 'Reopening fits instead of restoring the camera');
  for (const language of ['en', 'zh-CN']) {
    await page.evaluate(language => document.querySelector<HTMLButtonElement>(`.ui-language-button[data-ui-language="${language}"]`)!.click(), language);
    await page.waitForFunction(language => document.querySelector('.meo-mermaid-fullscreen-scrim [data-action="zoom-in"]')?.getAttribute('aria-label') === (language === 'en' ? 'Zoom in' : '放大'), {}, language);
    assert.equal(await nodeCount(), folded, 'Language changes preserve folding');
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--meo-font-live', 'Consolas'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('svg.meo-markmap')!).fontFamily.includes('Consolas'));
  await page.screenshot({ path: out + '/embedded-map-fullscreen.png' });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), text, 'Viewing gestures never change Markdown');
  await page.click('button[data-mode="preview"]');
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'preview');
  await waitInline();
  const previewCount = await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-contributed-block')!.shadowRoot!.querySelectorAll('g.markmap-node').length);
  assert.equal(previewCount, initial, 'Preview uses authored folds, not fullscreen viewing folds');
  await full(); await waitFull(); assert.equal(await nodeCount(), folded, 'Live and Preview share local fullscreen folding');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: out + '/embedded-map-preview.png' });
  await page.evaluate(() => {
    (window as any).ClipboardItem = class { constructor(readonly data: any) {} };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async write(items: any[]) {
      const blob = await items[0].data['image/png'];
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
      (window as any).__blockCopy = { width: bitmap.width, height: bitmap.height, png: canvas.toDataURL('image/png') };
    } } });
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector<HTMLElement>('.meo-copy-image-btn')!.click();
  });
  await page.waitForFunction(() => (window as any).__blockCopy);
  const copied = await page.evaluate(() => (window as any).__blockCopy);
  assert(copied.width > 200 && copied.height > 100, 'Copy encodes a complete PNG');
  writeFileSync(out + '/embedded-map-copy.png', Buffer.from(copied.png.split(',')[1], 'base64'));
  for (const preset of ['newsprint', 'whitey', 'obsidian-minimal', 'github-readme', 'default']) {
    await page.select('.preview-preset-control select', preset);
    await page.waitForFunction(preset => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.documentElement.dataset.meoPreviewPreset === preset, {}, preset);
    if (preset === 'github-readme') {
      assert.equal(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-contributed-block')), null, 'GitHub keeps the authored fence');
    } else await waitInline();
  }
  await page.select('.preview-appearance-select', 'dark'); await waitInline();
  await page.screenshot({ path: out + '/embedded-map-dark.png' });
  await full(); await waitFull(); assert.equal(await nodeCount(), folded, 'Preset and appearance changes retain viewing memory');
  await page.keyboard.press('Escape');
  await page.click('button[data-mode="live"]');
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('data-mode') === 'live' && document.querySelector<HTMLElement>('.preview-host')?.hidden);
  await waitInline();
  await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click());
  await page.waitForFunction(() => !document.querySelector('.editor-host .meo-contributed-block'));
  assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), text, 'Edit source only moves the caret');
  await page.evaluate(() => {
    const view = (window as any).__viewportTestView();
    const start = view.state.doc.toString().indexOf('# Trip');
    view.dispatch({ changes: { from: start, insert: '---\nmarkmap:\n  initialExpandLevel: 0\n---\n' }, selection: { anchor: 0 } });
  });
  await waitInline();
  await full(); await waitFull(); assert.equal(await nodeCount(), 1, 'Authored fold configuration overrides remembered fullscreen folds');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, insert: 'New paragraph.\n\n' }, selection: { anchor: 0 } });
  });
  await waitInline();
  await page.evaluate(() => document.querySelector('.editor-host .meo-contributed-block')!.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click());
  assert.equal(await page.evaluate(() => {
    const view = (window as any).__viewportTestView(); return view.state.doc.lineAt(view.state.selection.main.head).text;
  }), '---', 'Editing above a block maps its source action to the current body');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'documentViewsChanged', views: [] } })));
  await page.waitForFunction(() => !document.querySelector('.editor-host .meo-contributed-block'));
  assert((await page.evaluate(() => (window as any).__viewportTestText())).includes('```markmap'), 'Uninstalling the extension preserves source');
}
