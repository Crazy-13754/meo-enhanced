import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

/** Exercise the production block shell with the packaged local PlantUML Worker. */
export async function checkPlantUmlBlocks(page: Page, out: string) {
  const source = '@startuml\nAlice -> Bob: 你好\nBob --> Alice: Reply\n@enduml';
  const markdown = (body = source, language = 'plantuml') => `# PlantUML\n\n\`\`\`${language}\n${body}\n\`\`\`\n\n` + 'Paragraph.\n\n'.repeat(30);
  const replace = (text: string) => page.evaluate(text => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
    view.scrollDOM.scrollTop = 0;
  }, text);
  const wait = () => page.waitForFunction(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const owner = doc.querySelector('.meo-contributed-block');
    return owner?.shadowRoot?.querySelector('svg text') && !owner.closest('[data-meo-mermaid-rendering="true"]');
  });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame); });
  const measure = () => page.evaluate(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const root = doc.querySelector('.meo-contributed-block')!.shadowRoot!;
    const canvas = root.querySelector('.meo-contributed-canvas')!.getBoundingClientRect();
    const svg = root.querySelector('svg')!.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, svgWidth: svg.width, svgHeight: svg.height,
      centerX: svg.left + svg.width / 2 - canvas.left - canvas.width / 2 };
  });
  await replace(markdown()); await wait(); await settle();
  assert(await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.textContent?.includes('你好')));
  await page.screenshot({ path: out + '/plantuml-live.png' });
  const before = await page.evaluate(() => {
    const view = (window as any).__viewportTestView();
    const root = document.querySelector('.meo-contributed-block')!.shadowRoot!;
    const content = root.querySelector('.meo-contributed-content')!, r = content.getBoundingClientRect();
    return { x: r.left + 25, y: r.top + 25, scroll: view.scrollDOM.scrollTop,
      transform: (root.querySelector('.meo-mermaid-svg-wrapper') as HTMLElement).style.transform };
  });
  await page.mouse.move(before.x, before.y); await page.mouse.down(); await page.mouse.move(before.x + 40, before.y + 25, { steps: 5 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-content')!).cursor), 'grabbing');
  await page.mouse.up();
  assert.equal(await page.$('.meo-mermaid-editing-preview'), null);
  const camera = () => page.evaluate(() => (document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-mermaid-svg-wrapper') as HTMLElement).style.transform);
  const dragged = await camera(); assert.notEqual(dragged, before.transform);
  await page.mouse.wheel({ deltaY: 120 }); await settle();
  assert.equal(await camera(), dragged, 'Inline wheel belongs to document scrolling');
  assert(await page.evaluate(() => (window as any).__viewportTestView().scrollDOM.scrollTop) > before.scroll);
  await page.evaluate(() => document.querySelector<HTMLElement>('.meo-mermaid-fullscreen-btn')!.click());
  await page.waitForFunction(() => document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')?.shadowRoot?.querySelector('svg text'));
  const fullCamera = () => page.evaluate(() => (document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('.meo-mermaid-svg-wrapper') as HTMLElement).style.transform);
  await settle();
  assert(await page.evaluate(() => {
    const root = document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!;
    const c = root.querySelector('.meo-contributed-canvas')!.getBoundingClientRect(), s = root.querySelector('svg')!.getBoundingClientRect();
    return s.top >= c.top && s.bottom <= c.bottom && s.left >= c.left && s.right <= c.right;
  }), 'Fullscreen initially fits the complete graph');
  const initial = await fullCamera();
  await page.click('.meo-mermaid-fullscreen-scrim [data-action="zoom-in"]');
  assert.notEqual(await fullCamera(), initial);
  const zoomed = await fullCamera();
  for (const language of ['en', 'zh-CN']) {
    await page.evaluate(language => document.querySelector<HTMLButtonElement>(`.ui-language-button[data-ui-language="${language}"]`)!.click(), language);
    await page.waitForFunction(language => document.querySelector('.meo-mermaid-fullscreen-scrim [data-action="zoom-in"]')?.getAttribute('aria-label') === (language === 'en' ? 'Zoom in' : '放大'), {}, language);
    assert.equal(await fullCamera(), zoomed, 'Language changes preserve the camera');
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--meo-font-live', 'Consolas'));
  await page.waitForFunction(() => document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block')!.shadowRoot!.querySelector('text')?.getAttribute('font-family') === 'Consolas');
  assert.equal(await fullCamera(), zoomed, 'Font refresh preserves the camera');
  await page.click('.meo-mermaid-fullscreen-scrim [data-action="fit"]'); await settle();
  await page.screenshot({ path: out + '/plantuml-fullscreen.png' }); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), markdown());

  // Common diagrams run sequentially through one engine without leaking state.
  for (const body of ['class Alpha\nclass Beta\nAlpha --> Beta', 'start\n:中文活动;\nstop', '[*] --> Ready\nReady --> [*]', '[Client] --> [Server]', '!theme plain\nAlice -> Bob: Theme']) {
    await replace(markdown('@startuml\n' + body + '\n@enduml', 'puml')); await wait();
    assert.equal(await page.evaluate(() => !!document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.failure')), false);
  }
  await replace(markdown()); await wait();
  // Source editing reuses Mermaid's source/preview layout and native undo.
  await page.click('.meo-mermaid-mode-btn');
  await page.waitForSelector('.meo-mermaid-editing-preview');
  await page.click('.meo-mermaid-layout-btn'); await page.waitForSelector('.meo-mermaid-inline-preview');
  await page.click('.meo-mermaid-mode-btn'); await wait();
  for (const large of [false, true]) {
    const text = markdown() + (large ? 'Paragraph.\n\n'.repeat(24000) : '');
    await replace(text); await wait();
    if (large) await page.waitForFunction(() => (window as any).__viewportTestLargeBudget());
    await page.click('.meo-mermaid-mode-btn'); await wait();
    await page.evaluate(() => {
      const view = (window as any).__viewportTestView(), at = view.state.doc.toString().indexOf('Reply');
      view.dispatch({ selection: { anchor: at, head: at + 5 } }); view.focus();
    });
    await page.keyboard.type('Updated');
    await page.waitForFunction(() => document.querySelector('.meo-contributed-block')?.shadowRoot?.querySelector('svg')?.textContent?.includes('Updated'));
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await page.waitForFunction(text => (window as any).__viewportTestText() === text, {}, text);
    await page.keyboard.press('Escape'); await wait();
    if (large) {
      assert(await page.evaluate(() => (window as any).__blockWorkerContexts > 0));
      assert(await page.$$eval('.cm-line', lines => lines.length < 200));
    }
  }
  for (const bad of ['@startuml\nnot valid ???\n@enduml', '@startuml\n!include https://example.invalid/private.puml\n@enduml']) {
    await replace(markdown(bad));
    await page.waitForFunction(() => !!document.querySelector('.meo-contributed-block')?.shadowRoot?.querySelector('.failure'));
    assert.equal(await page.evaluate(() => !!document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('svg')), false);
    assert((await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.textContent))?.includes(bad));
    await replace(markdown()); await wait();
  }
  // Preview is static, but retains shared copy/fullscreen and responsive sizing.
  await page.click('button[data-mode="preview"]'); await wait();
  assert.equal(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-content')!.hasAttribute('inert')), true);
  for (const mode of ['preview', 'live']) {
    await page.click(`button[data-mode="${mode}"]`); await wait(); await settle(); const wide = await measure();
    await page.setViewport({ width: 440, height: 800 }); await settle(); const narrow = await measure();
    assert(narrow.svgWidth <= narrow.width && narrow.height <= wide.height + 2);
    assert(Math.abs(narrow.centerX) < 3, JSON.stringify(narrow));
    await page.setViewport({ width: 1280, height: 800 }); await settle();
  }
  await page.click('button[data-mode="preview"]'); await wait();
  for (const preset of ['newsprint', 'whitey', 'obsidian-minimal', 'github-readme', 'default']) {
    await page.select('.preview-preset-control select', preset);
    await page.waitForFunction(preset => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.documentElement.dataset.meoPreviewPreset === preset, {}, preset);
    if (preset === 'github-readme') assert.equal(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-contributed-block')), null);
    else await wait();
  }
  await page.select('.preview-appearance-select', 'dark'); await wait(); await settle();
  await page.evaluate(() => { document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop = 0; }); await settle();
  await page.screenshot({ path: out + '/plantuml-preview-dark.png' });
  await page.evaluate(() => {
    (window as any).ClipboardItem = class { constructor(readonly data: any) {} };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async write(items: any[]) {
      const bitmap = await createImageBitmap(await items[0].data['image/png']);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0); (window as any).__pumlCopy = canvas.toDataURL('image/png');
    } } });
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector<HTMLElement>('.meo-copy-image-btn')!.click();
  });
  await page.waitForFunction(() => (window as any).__pumlCopy);
  writeFileSync(out + '/plantuml-copy.png', Buffer.from((await page.evaluate(() => (window as any).__pumlCopy)).split(',')[1], 'base64'));
  await page.click('button[data-mode="live"]'); await replace(markdown('@startuml\nskinparam defaultFontColor #123456\nskinparam backgroundColor #f0f0f0\nAlice -> Bob: Styled\n@enduml')); await wait();
  assert.equal(await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('text')!.getAttribute('fill')?.toLowerCase()), '#123456');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'documentViewsChanged', views: [] } })));
  await page.waitForFunction(() => !document.querySelector('.meo-contributed-block'));
  assert((await page.evaluate(() => (window as any).__viewportTestText())).includes('Alice -> Bob: Styled'), 'Disabling a feature preserves its source');
}
