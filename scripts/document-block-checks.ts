import assert from 'node:assert/strict';
import type { Page } from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { assessLargeDocument } from '../src/foundation/largeDocument';

export async function checkDocumentBlocks(page: Page, out: string) {
  const checkWheel = async (fullscreen = false) => {
    const snapshot = () => page.evaluate(fullscreen => {
      const preview = document.querySelector('#app')?.getAttribute('data-mode') === 'preview';
      const frame = document.querySelector<HTMLIFrameElement>('.preview-frame');
      const doc = preview && !fullscreen ? frame!.contentDocument! : document;
      const owner = doc.querySelector(fullscreen ? '.meo-mermaid-fullscreen-scrim .meo-contributed-block' : '.editor-host .meo-contributed-block,.meo-contributed-block')!;
      const svg = owner.shadowRoot!.querySelector('svg.meo-markmap')!;
      const rect = svg.getBoundingClientRect();
      const offset = preview && !fullscreen ? frame!.getBoundingClientRect() : { left: 0, top: 0 };
      const scroller = preview && !fullscreen ? doc.scrollingElement! : (window as any).__viewportTestView().scrollDOM;
      const visibleTop = Math.max(rect.top + offset.top, preview && !fullscreen ? offset.top : 40);
      const visibleBottom = Math.min(rect.bottom + offset.top, window.innerHeight);
      return { cursor: doc.defaultView!.getComputedStyle(svg).cursor, camera: JSON.stringify((svg as any).__zoom), scroll: scroller.scrollTop,
        x: rect.left + offset.left + rect.width / 2, y: (visibleTop + visibleBottom) / 2 };
    }, fullscreen);
    const before = await snapshot();
    assert.equal(before.cursor, 'default', 'Inline and fullscreen idle canvas use an arrow');
    await page.mouse.move(before.x, before.y); await page.mouse.wheel({ deltaY: 120 });
    await new Promise(resolve => setTimeout(resolve, 250));
    const after = await snapshot();
    if (fullscreen) assert.notEqual(after.camera, before.camera, 'Fullscreen wheel still operates the canvas');
    else {
      assert.equal(after.camera, before.camera, 'Inline wheel must not move or zoom the graph');
      assert(after.scroll > before.scroll, `Inline wheel scrolls the document: ${JSON.stringify({ before, after })}`);
    }
  };
  const text = '# Embedded map\n\n```markmap\n# Trip\n## Travel\n- Train\n- Bus\n> Outer quote\n>\n> > Inner quote\n\n<table><tr><td><blockquote><p>Cell outer</p>\n<blockquote><p>Cell inner</p></blockquote>\n</blockquote></td></tr></table>\n## Visit\n- Museum\n- Park\n```\n\nEnd.\n' + 'Following paragraph.\n\n'.repeat(30);
  await page.evaluate(text => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
  }, text);
  const waitInline = () => page.waitForFunction(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const root = doc.querySelector('.meo-contributed-block')?.shadowRoot;
    const button = doc.querySelector<HTMLElement>('.meo-mermaid-fullscreen-btn,.meo-preview-fullscreen-btn');
    return root?.querySelector('g.markmap-node') && button && !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true';
  });
  const full = () => page.evaluate(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    doc.querySelector<HTMLElement>('.meo-mermaid-fullscreen-btn,.meo-preview-fullscreen-btn')!.click();
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
  assert.equal(await page.evaluate(() => document.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-content')!.hasAttribute('inert')), false);
  const assertCanvasPalette = async () => assert.equal(await page.evaluate(() => {
    const owner = document.querySelector('.editor-host .meo-graph-block')!;
    const canvas = owner.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-canvas')!;
    const probe = document.createElement('span'); probe.style.color = 'var(--meo-view-background)'; canvas.append(probe);
    const palette = getComputedStyle(probe).color; probe.remove();
    return getComputedStyle(canvas).backgroundColor === 'rgba(0, 0, 0, 0)' && palette === getComputedStyle(owner).backgroundColor;
  }), true, 'Mounted graph inherits the actual code surface, not detached default colors');
  await assertCanvasPalette();
  const checkNodeInteraction = async (fullscreen: boolean) => {
    const before = await page.evaluate(fullscreen => {
      const owner = document.querySelector(fullscreen ? '.meo-mermaid-fullscreen-scrim .meo-contributed-block' : '.editor-host .meo-contributed-block')!;
      const root = owner.shadowRoot!;
      const label = root.querySelector('foreignObject > div > div')!;
      const rect = label.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, count: root.querySelectorAll('g.markmap-node').length };
    }, fullscreen);
    await page.mouse.move(before.x, before.y); await page.mouse.click(before.x, before.y);
    const result = await page.evaluate(fullscreen => {
      const root = document.querySelector(fullscreen ? '.meo-mermaid-fullscreen-scrim .meo-contributed-block' : '.editor-host .meo-contributed-block')!.shadowRoot!;
      const outline = getComputedStyle(root.querySelector('foreignObject > div > div')!).outlineStyle;
      if (!fullscreen) root.querySelector('circle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { outline, cursor: getComputedStyle(root.querySelector('foreignObject > div > div')!).cursor,
        circle: getComputedStyle(root.querySelector('circle')!).cursor, count: root.querySelectorAll('g.markmap-node').length, buttons: root.querySelectorAll('circle[role=button]').length };
    }, fullscreen);
    assert.equal(result.outline, 'none', 'Block labels do not highlight on hover');
    assert.equal(result.cursor, 'default', 'Labels keep the arrow in both presentations');
    assert.equal(result.circle, fullscreen ? 'pointer' : 'default', 'Only fullscreen folding circles advertise clicks');
    assert.equal(result.count, before.count, 'Content clicks do not change nodes');
    if (!fullscreen) assert.equal(result.buttons, 0, 'Inline nodes do not expose folding controls');
  };
  await checkNodeInteraction(false);
  const quoteStyle = () => page.evaluate(() => {
    const owner = document.querySelector('.meo-mermaid-fullscreen-scrim .meo-contributed-block') ?? document.querySelector('.editor-host .meo-contributed-block');
    const quotes = [...owner!.shadowRoot!.querySelectorAll('blockquote')].filter(q => q.querySelector('blockquote'));
    return quotes.map(quote => {
    const inner = quote.querySelector('blockquote')!;
    const p = quote.querySelector('p')!;
    const scale = (owner!.shadowRoot!.querySelector('svg') as any).__zoom.k;
    return { whitespace: getComputedStyle(quote).whiteSpace, gap: (inner.getBoundingClientRect().top - p.getBoundingClientRect().bottom) / scale };
    });
  });
  const inlineQuote = await quoteStyle();
  const drag = await page.evaluate(() => {
    const svg = document.querySelector('.editor-host .meo-contributed-block')!.shadowRoot!.querySelector('svg')!;
    const r = svg.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20, camera: JSON.stringify((svg as any).__zoom) };
  });
  const inlineCursor = () => page.evaluate(() => getComputedStyle(document.querySelector('.editor-host .meo-contributed-block')!.shadowRoot!.querySelector('svg')!).cursor);
  assert.equal(await inlineCursor(), 'default');
  await page.mouse.move(drag.x, drag.y); await page.mouse.down();
  assert.equal(await inlineCursor(), 'default');
  await page.mouse.move(drag.x + 2, drag.y + 1);
  assert.equal(await inlineCursor(), 'default');
  await page.mouse.move(drag.x + 35, drag.y + 25, { steps: 5 });
  assert.equal(await inlineCursor(), 'grabbing');
  await page.mouse.up();
  assert.equal(await inlineCursor(), 'default');
  assert.notEqual(await page.evaluate(() => JSON.stringify((document.querySelector('.editor-host .meo-contributed-block')!.shadowRoot!.querySelector('svg') as any).__zoom)), drag.camera, 'Inline mouse drag moves the canvas');
  assert.equal(await page.$('.meo-mermaid-editing-preview'), null, 'Dragging the canvas does not enter source editing');
  await page.mouse.click(drag.x, drag.y);
  assert.equal(await page.$('.meo-mermaid-editing-preview'), null, 'Clicking blank canvas does not enter source editing');
  const label = await page.evaluate(() => {
    const rect = document.querySelector('.editor-host .meo-contributed-block')!.shadowRoot!.querySelector('foreignObject')!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(label.x, label.y);
  assert.equal(await page.$('.meo-mermaid-editing-preview'), null, 'Clicking a node does not enter source editing');
  await checkWheel();
  await full(); await waitFull(); const initial = await nodeCount();
  await checkNodeInteraction(true);
  const fullQuote = await quoteStyle();
  assert.equal(inlineQuote.length, 2, 'Cover standalone and table-cell nested quotes');
  inlineQuote.forEach((quote, index) => {
    assert.equal(quote.whitespace, fullQuote[index]!.whitespace);
    assert(Math.abs(quote.gap - fullQuote[index]!.gap) < 0.1, 'Inline and fullscreen nested quotes have the same spacing');
  });
  await checkWheel(true);
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
  assert.equal(await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const owner = doc.querySelector('.meo-export-graph')!;
    const probe = doc.createElement('div'); probe.className = 'meo-export-mermaid'; owner.parentElement!.append(probe);
    const canvas = owner.querySelector('.meo-contributed-block')!.shadowRoot!.querySelector('.meo-contributed-canvas')!;
    const same = doc.defaultView!.getComputedStyle(owner).backgroundColor === doc.defaultView!.getComputedStyle(probe).backgroundColor
      && doc.defaultView!.getComputedStyle(canvas).backgroundColor === 'rgba(0, 0, 0, 0)';
    probe.remove(); return same;
  }), true, 'Default Preview graphs use the same background as Mermaid');
  await checkWheel();
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
      (window as any).__blockCopy = { width: bitmap.width, height: bitmap.height, png: canvas.toDataURL('image/png'), corner: [...ctx.getImageData(0, 0, 1, 1).data] };
    } } });
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector<HTMLElement>('.meo-copy-image-btn')!.click();
  });
  await page.waitForFunction(() => (window as any).__blockCopy);
  const copied = await page.evaluate(() => (window as any).__blockCopy);
  assert(copied.width > 200 && copied.height > 100, 'Copy encodes a complete PNG');
  const expectedBackground = await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
    ctx.fillStyle = doc.defaultView!.getComputedStyle(doc.querySelector('.meo-export-graph')!).backgroundColor;
    ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  assert.deepEqual(copied.corner, expectedBackground, 'Copy crosses Shadow DOM to retain the actual opaque graph surface');
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
  await page.click('.meo-mermaid-mode-btn');
  await page.waitForFunction(() => document.querySelector('.meo-mermaid-toolbar[data-meo-mermaid-mode=edit]') && document.querySelector('.meo-mermaid-editing-preview .meo-contributed-block'));
  await waitInline();
  assert.equal(await page.$eval('.meo-mermaid-mode-btn', e => e.getAttribute('aria-label')), '完成编辑');
  await assertCanvasPalette();
  await page.screenshot({ path: out + '/embedded-map-editing.png' });
  await page.click('.meo-mermaid-layout-btn');
  await page.waitForFunction(() => !!document.querySelector('.meo-mermaid-inline-preview'));
  await waitInline();
  await page.screenshot({ path: out + '/embedded-map-editing-side.png' });
  await page.click('.meo-mermaid-mode-btn');
  await page.waitForFunction(() => !document.querySelector('.meo-mermaid-editing-preview'));
  await waitInline();
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
  await page.click('.meo-mermaid-mode-btn');
  assert.equal(await page.evaluate(() => {
    const view = (window as any).__viewportTestView(); return view.state.doc.lineAt(view.state.selection.main.head).text;
  }), '---', 'Editing above a block maps its source action to the current body');
  // The same native editor path must work when the production Worker/budget takes over.
  for (const large of [false, true]) {
    const source = text + 'Following paragraph.\n\n'.repeat(large ? 12000 : 15);
    assert.equal(assessLargeDocument(source).boundedEditorWork, large);
    await page.evaluate(source => {
      const view = (window as any).__viewportTestView();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 0 } });
      view.scrollDOM.scrollTop = 0;
    }, source);
    if (large) await page.waitForFunction(() => (window as any).__viewportTestLargeBudget());
    await waitInline();
    assert.equal(await page.evaluate(() => (window as any).__viewportTestLargeBudget()), large);
    await checkWheel();
    await page.click('.meo-mermaid-mode-btn');
    await page.waitForFunction(() => !!document.querySelector('.meo-mermaid-toolbar[data-meo-mermaid-mode=edit]'));
    await page.keyboard.press('End'); await page.keyboard.type(' revised');
    await page.waitForFunction(() => [...document.querySelectorAll('.meo-contributed-block')].some(e => e.shadowRoot?.textContent?.includes('Trip revised')));
    assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), source.replace('# Trip', '# Trip revised'));
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await page.waitForFunction(source => (window as any).__viewportTestText() === source, {}, source);
    await page.keyboard.press('Escape');
    try { await page.waitForFunction(() => !!document.querySelector('.meo-rendered-block-preview .meo-contributed-block') && !document.querySelector('.meo-mermaid-editing-preview')); }
    catch (error) {
      console.log('Graph finish diagnostic', large, await page.evaluate(() => {
        const view = (window as any).__viewportTestView();
        return { selection: view.state.selection.main.toJSON(), focus: document.activeElement?.className,
          source: view.state.doc.sliceString(0, 200), blocks: [...document.querySelectorAll('.meo-mermaid-toolbar')].map(e => e.outerHTML),
          preview: document.querySelector('.meo-mermaid-editing-preview')?.outerHTML.slice(0, 1000) };
      })); throw error;
    }
    await waitInline();
    if (large) {
      assert(await page.evaluate(() => (window as any).__blockWorkerContexts > 0), 'Large source uses the actual Markdown Worker');
      assert(await page.$$eval('.cm-line', lines => lines.length < 200), 'Large document keeps mounted source bounded');
    }
  }
  await page.evaluate(() => {
    const view = (window as any).__viewportTestView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Small\n\n```markmap\n# Trip\n## Travel\n- Train\n- Bus\n```\n' }, selection: { anchor: 0 } });
    view.scrollDOM.scrollTop = 0;
  });
  await waitInline();
  assert(await page.evaluate(() => document.querySelector('.meo-contributed-block')!.getBoundingClientRect().height < 260), 'Small maps shrink instead of reserving a fixed 360px canvas');
  const spacing = await page.evaluate(() => {
    const owner = document.querySelector('.editor-host .meo-graph-block')!;
    const nodes = [...owner.querySelector('.meo-contributed-block')!.shadowRoot!.querySelectorAll('g.markmap-node')].map(node => node.getBoundingClientRect());
    const rect = owner.getBoundingClientRect(), style = getComputedStyle(owner);
    return { top: Math.min(...nodes.map(node => node.top)) - rect.top,
      bottom: rect.bottom - Math.max(...nodes.map(node => node.bottom)),
      paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom) };
  });
  assert(spacing.top <= spacing.paddingTop + 8, `Small Live graphs do not reserve the top toolbar twice: ${JSON.stringify(spacing)}`);
  assert(spacing.bottom <= Math.max(32, spacing.paddingBottom) + 8, `Small Live graphs do not reserve excess bottom space: ${JSON.stringify(spacing)}`);
  await page.screenshot({ path: out + '/embedded-map-compact.png' });
  // Inline resize must use intrinsic content, not multiply the current camera
  // by the window-width ratio when the map already fits at its reading scale.
  const resizeFailures: string[] = [];
  const measureInline = () => page.evaluate(() => {
    const doc = document.querySelector('#app')?.getAttribute('data-mode') === 'preview'
      ? document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument! : document;
    const root = doc.querySelector('.meo-contributed-block')!.shadowRoot!;
    const svg = root.querySelector('svg')!, graph = root.querySelector('[data-meo-image-content]')!;
    const canvas = root.querySelector('.meo-contributed-canvas')!.getBoundingClientRect(), bounds = graph.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, graphWidth: bounds.width, graphHeight: bounds.height,
      centerX: bounds.left + bounds.width / 2 - canvas.left - canvas.width / 2, scale: (svg as any).__zoom.k };
  });
  const settleResize = () => page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0; const frame = () => ++frames === 10 ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame);
  }));
  for (const large of [false, true]) {
    if (large) {
      await page.click('button[data-mode="live"]');
      await page.evaluate(() => {
        const view = (window as any).__viewportTestView();
        view.dispatch({ changes: { from: view.state.doc.length, insert: '\nParagraph.\n\n'.repeat(24000) } });
      });
      await page.waitForFunction(() => (window as any).__viewportTestLargeBudget());
    }
    const unchanged = await page.evaluate(() => (window as any).__viewportTestText());
    for (const mode of ['live', 'preview'] as const) {
      await page.setViewport({ width: 1280, height: 800 });
      await page.click(`button[data-mode="${mode}"]`); await waitInline(); await settleResize();
      const wide = await measureInline();
      for (const width of [900, 440, 1280, 600, 1280]) {
        await page.setViewport({ width, height: 800 }); await settleResize();
        const current = await measureInline();
        const expected = Math.min(wide.scale, (current.width - 32) * 0.95 / (wide.graphWidth / wide.scale));
        if (Math.abs(current.scale - expected) > 0.06) resizeFailures.push(`${mode}/${width}: readable scale, ${JSON.stringify({wide, current, expected})}`);
        if (current.height - current.graphHeight > wide.height - wide.graphHeight + 12) resizeFailures.push(`${mode}/${width}: excess canvas height, ${JSON.stringify({wide, current})}`);
        if (expected < wide.scale * 0.8 && current.height >= wide.height - 2) resizeFailures.push(`${mode}/${width}: constrained map must shorten its canvas`);
        if (Math.abs(current.centerX) > 3) resizeFailures.push(`${mode}/${width}: map must stay horizontally centered, ${JSON.stringify(current)}`);
        if (!large && (width === 440 || width === 900)) await page.screenshot({ path: out + `/embedded-resize-${mode}-${width}.png` });
      }
    }
    assert.equal(await page.evaluate(() => (window as any).__viewportTestText()), unchanged, 'Resize never edits ordinary or large documents');
  }
  assert.deepEqual(resizeFailures, [], 'Inline Live/Preview maps retain readable size while they fit, then reduce both diagram and canvas height');
  await page.click('button[data-mode="live"]'); await waitInline();
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'documentViewsChanged', views: [] } })));
  await page.waitForFunction(() => !document.querySelector('.editor-host .meo-contributed-block'));
  assert((await page.evaluate(() => (window as any).__viewportTestText())).includes('```markmap'), 'Uninstalling the extension preserves source');
}
