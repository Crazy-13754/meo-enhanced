import assert from 'node:assert/strict';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';
import { createPreviewDocument } from '../src/export/previewDocument';
import { assessLargeDocument } from '../src/foundation/largeDocument';
import sharp from 'sharp';

const build = await Bun.build({
  entrypoints: ['scripts/test-settings-window-production-entry.ts'],
  target: 'browser',
  format: 'iife'
});
if (!build.success) throw new Error(build.logs.map(String).join('\n'));

const browser = await launchTestBrowser();
let primaryError: unknown;
let previewRenderGate: Promise<void> | null = null;
try {
  if (!process.argv.includes('--navigation-only')) {
    const precisionBuild = await Bun.build({ entrypoints: ['scripts/test-preview-code-update-entry.ts'], target: 'browser', format: 'iife' });
    assert.ok(precisionBuild.success, precisionBuild.logs.map(String).join('\n'));
    for (const windowed of [false, true]) await assertMarkerPrecision(await browser.newPage(), await precisionBuild.outputs[0]!.text(), windowed);
  }
  if (!process.argv.includes('--precision-only')) {
    for (const windowed of [false, true]) await assertMarkerContinuity(await browser.newPage(), await build.outputs[0]!.text(), windowed, false, true);
  }
  if (!process.argv.includes('--precision-only') && !process.argv.includes('--navigation-only')) {
  for (const windowed of [false, true]) {
    for (const imageAbove of [true, false]) {
      await assertMarkerContinuity(await browser.newPage(), await build.outputs[0]!.text(), windowed, imageAbove);
    }
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 720 });
  await page.exposeFunction('__renderSourcePositionPreview', async (message: any) => {
    if (message.type !== 'requestPreviewRender') return null;
    await previewRenderGate;
    return {
      type: 'previewRenderResult',
      requestId: message.requestId,
      result: {
        ok: true,
        value: exportRuntime.renderPreviewDocument({
          layout: message.layout, markdownText: message.text,
          sourceDocumentPath: 'C:/tmp/source-position-marker.md',
          uiLanguage: message.uiLanguage,
          styleEnvironment: message.environment
        })
      }
    };
  });
  await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  await page.addScriptTag({ content: `window.acquireVsCodeApi=()=>({getState(){return {}},setState(){},postMessage(message){window.__renderSourcePositionPreview(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent('message',{data:response}));});}});` });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });

  const text = [
    '# Marker fixture',
    '',
    'The first paragraph stays visible in Source.',
    'A multiline paragraph starts here.\nIts second source line shares one rendered paragraph.',
    '> An indented quotation must not move the Preview locator horizontally.',
    '- An indented list item must use the same Preview locator gutter.',
    '- Reverse locator middle item.',
    '- Reverse locator lower item.',
    '```text\n' + Array.from({ length: 60 }, (_, index) => `Locator code line ${index}`).join('\n') + '\n```',
    ...Array.from({ length: 90 }, (_, index) => (
      `## Section ${index + 1}\n\nParagraph ${index + 1} with enough text to create a distant Preview position.`
    )),
    '## Nested locator fixture',
    '- [ ] > A task followed by a quote marker.\n- > - [ ] Nested task for bottom-edge navigation.',
    'Following paragraph keeps the nested task independently scrollable.',
    '<!-- Hidden source-only navigation target -->'
  ].join('\n\n');
  await page.evaluate(text => {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'init', documentId: 'file:///source-position-marker.md', text, version: 1,
      savedRevision: { version: 1, text }, diagnostics: [], mode: 'source', uiLanguage: 'en',
      uiLanguagePreference: 'auto', automaticUiLanguage: 'en', sourceLineNumbers: 'on',
      previewAppearance: 'dark', previewFontFamily: '', previewSourceColoring: true,
      editorAppearance: 'dark', editorFontSizeMode: 'auto', editorFontSize: 14,
      gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false,
      diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false,
      contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false },
      outlinePosition: 'right', outlineVisible: false, outlineWidth: 260,
      restoreReadingPositionOnOpen: false, vscodeTheme: null
    } }));
  }, text);
  await page.waitForSelector('.cm-content');
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLElement>('.source-preview-button');
    return button?.offsetParent !== null && getComputedStyle(button).visibility === 'visible';
  });
  await page.click('.source-preview-button');
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>('.preview-frame');
    const previewHost = document.querySelector<HTMLElement>('.preview-host');
    return document.querySelector('.editor-surface')?.hasAttribute('data-source-preview')
      && frame?.contentDocument?.body.textContent?.includes('Section 90')
      && previewHost?.inert === false
      && getComputedStyle(previewHost).visibility !== 'hidden'
      && !frame.contentDocument?.querySelector<HTMLElement>('.meo-preview-source-position-marker')?.hidden;
  });
  await new Promise(resolve => setTimeout(resolve, 120));

  const markerPresentation = await page.evaluate(() => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    const style = frameDocument.defaultView!.getComputedStyle(marker);
    const cursor = marker.querySelector<HTMLElement>('.meo-preview-source-position-cursor')!;
    const rail = marker.querySelector<HTMLElement>('.meo-preview-source-position-rail')!;
    const cursorRect = cursor.getBoundingClientRect();
    const readingRoot = frameDocument.querySelector<HTMLElement>('main.meo-export-doc')!;
    const activeLineBackground = getComputedStyle(document.querySelector<HTMLElement>('.cm-activeLine')!).backgroundColor;
    return {
      active: marker.classList.contains('is-active'),
      line: marker.dataset.meoSourcePositionLine,
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      position: style.position,
      pointerEvents: style.pointerEvents,
      backgroundColor: style.backgroundColor,
      activeLineBackground,
      zIndex: style.zIndex,
      kind: marker.dataset.meoSourcePositionKind,
      ownerDocument: marker.ownerDocument === frameDocument,
      parentIsReadingRoot: marker.parentElement === readingRoot,
      cursorWidth: cursorRect.width,
      cursorDisplay: frameDocument.defaultView!.getComputedStyle(cursor).display,
      railDisplay: frameDocument.defaultView!.getComputedStyle(rail).display,
      usesTextCursorIcon: cursor.querySelector('svg')?.classList.contains('lucide-text-cursor'),
      railBorderRadius: frameDocument.defaultView!.getComputedStyle(rail).borderRadius,
      markerLeft: marker.getBoundingClientRect().left,
      markerRight: marker.getBoundingClientRect().right,
      positioningWidth: marker.offsetParent!.getBoundingClientRect().width
    };
  });
  assert.equal(markerPresentation.active, true);
  assert.equal(markerPresentation.line, '1');
  assert.ok(markerPresentation.width >= 3, JSON.stringify(markerPresentation));
  assert.ok(markerPresentation.height > 1, JSON.stringify(markerPresentation));
  assert.equal(markerPresentation.position, 'absolute');
  assert.equal(markerPresentation.pointerEvents, 'none');
  assert.notEqual(markerPresentation.backgroundColor, 'rgba(0, 0, 0, 0)', 'Preview locator stays visible with a transparent native Source line highlight');
  assert.equal(markerPresentation.kind, 'line');
  assert.equal(markerPresentation.ownerDocument, true);
  assert.equal(markerPresentation.parentIsReadingRoot, true);
  assert.equal(markerPresentation.cursorWidth, 0);
  assert.equal(markerPresentation.cursorDisplay, 'none');
  assert.equal(markerPresentation.railDisplay, 'none');
  assert.equal(markerPresentation.usesTextCursorIcon, true);
  assert.equal(markerPresentation.railBorderRadius, '0px');
  assert.ok(Math.abs(markerPresentation.markerLeft) <= 0.5, JSON.stringify(markerPresentation));
  assert.ok(Math.abs(markerPresentation.markerRight - markerPresentation.positioningWidth) <= 0.5, JSON.stringify(markerPresentation));

  await page.$eval('.preview-appearance-select', element => {
    const select = element as HTMLSelectElement;
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction((darkBackground) => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    return frameDocument.defaultView!.getComputedStyle(marker).backgroundColor !== darkBackground;
  }, {}, markerPresentation.backgroundColor);
  const lightMarkerBackground = await page.evaluate(() => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    return frameDocument.defaultView!.getComputedStyle(marker).backgroundColor;
  });
  assert.notEqual(lightMarkerBackground, 'rgba(0, 0, 0, 0)');
  assert.notEqual(lightMarkerBackground, markerPresentation.backgroundColor, 'Preview locator follows the independently selected Preview theme');
  assert.equal(await page.$eval('.cm-activeLine', element => getComputedStyle(element).backgroundColor), markerPresentation.activeLineBackground,
    'Changing Preview theme must not change the native Source line highlight');
  await page.$eval('.preview-appearance-select', element => {
    const select = element as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction((darkBackground) => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    return frameDocument.defaultView!.getComputedStyle(marker).backgroundColor === darkBackground;
  }, {}, markerPresentation.backgroundColor);

  const nativeScrollAttachment = await page.evaluate(() => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    const target = frameDocument.querySelector<HTMLElement>('[data-source-line="1"]')!;
    const before = marker.getBoundingClientRect().top - target.getBoundingClientRect().top;
    frameDocument.scrollingElement!.scrollTop += 80;
    const after = marker.getBoundingClientRect().top - target.getBoundingClientRect().top;
    return { before, after };
  });
  assert.ok(
    Math.abs(nativeScrollAttachment.after - nativeScrollAttachment.before) <= 0.1,
    `Marker must move in the Preview document's native scroll layer: ${JSON.stringify(nativeScrollAttachment)}`
  );

  const multilineSourceTarget = await page.$$eval('.cm-line', elements => {
    const line = elements.find(element => element.textContent?.includes('Its second source line'))!;
    const rect = line.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(multilineSourceTarget.x, multilineSourceTarget.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  const blockProjection = await page.evaluate(() => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    const paragraph = [...frameDocument.querySelectorAll<HTMLElement>('p')]
      .find(element => element.textContent?.includes('Its second source line'))!;
    const walker = frameDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode()) && !text.textContent?.includes('Its second source line')) {}
    const range = frameDocument.createRange(); range.selectNodeContents(text!);
    const textRect = range.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const lineHeight = Number.parseFloat(frameDocument.defaultView!.getComputedStyle(paragraph).lineHeight);
    return {
      kind: marker.dataset.meoSourcePositionKind,
      containsText: markerRect.top <= textRect.top + 0.5 && markerRect.bottom >= textRect.bottom - 0.5,
      height: markerRect.height, lineHeight,
      isSecondLine: markerRect.top >= paragraph.getBoundingClientRect().top + lineHeight - 1
    };
  });
  assert.equal(blockProjection.kind, 'line', JSON.stringify(blockProjection));
  assert.ok(blockProjection.containsText && blockProjection.isSecondLine, JSON.stringify(blockProjection));
  assert.ok(blockProjection.height <= blockProjection.lineHeight + 1, JSON.stringify(blockProjection));

  for (const sourceText of ['An indented quotation', 'An indented list item']) {
    const indentedTarget = await page.$$eval('.cm-line', (elements, expectedText) => {
      const line = elements.find(element => element.textContent?.includes(expectedText))!;
      const rect = line.getBoundingClientRect();
      return { x: rect.left + 24, y: rect.top + rect.height / 2 };
    }, sourceText);
    await page.mouse.click(indentedTarget.x, indentedTarget.y);
    await new Promise(resolve => setTimeout(resolve, 40));
    const markerLeft = await page.evaluate(() => {
      const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      return frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!
        .getBoundingClientRect().left;
    });
    assert.ok(
      Math.abs(markerLeft - markerPresentation.markerLeft) <= 0.5,
      `Preview locator must use a fixed horizontal gutter: ${JSON.stringify({ sourceText, markerLeft, expected: markerPresentation.markerLeft })}`
    );
  }

  const sourceTarget = await page.$eval('.cm-line', element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  const movePreviewToBottom = () => page.evaluate(() => {
    const scrollElement = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!;
    scrollElement.scrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    return scrollElement.scrollTop;
  });

  const bottomBeforeKeyboard = await movePreviewToBottom();
  await new Promise(resolve => setTimeout(resolve, 40));
  const lineBeforeKeyboard = await page.evaluate(() => (
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      .querySelector<HTMLElement>('.meo-preview-source-position-marker')!.dataset.meoSourcePositionLine
  ));
  await page.keyboard.press('Home');
  await new Promise(resolve => setTimeout(resolve, 40));
  const afterKeyboard = await page.evaluate(() => ({
    previewTop: document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop,
    markerLine: document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      .querySelector<HTMLElement>('.meo-preview-source-position-marker')!.dataset.meoSourcePositionLine,
    visible: (() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const marker = doc.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
      const r = marker.getBoundingClientRect();
      return !marker.hidden && r.bottom > 0 && r.top < doc.documentElement.clientHeight;
    })()
  }));
  assert.equal(afterKeyboard.markerLine, lineBeforeKeyboard);
  assert.ok(afterKeyboard.visible && afterKeyboard.previewTop < bottomBeforeKeyboard - 1, JSON.stringify(afterKeyboard));

  await page.mouse.click(sourceTarget.x, sourceTarget.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  const afterExplicitClick = await page.evaluate(() => {
    const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const marker = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
    const markerRect = marker.getBoundingClientRect();
    return {
      previewTop: frameDocument.scrollingElement!.scrollTop,
      visible: markerRect.bottom > 0 && markerRect.top < frameDocument.documentElement.clientHeight,
      active: marker.classList.contains('is-active')
    };
  });
  assert.equal(afterExplicitClick.visible, true, JSON.stringify(afterExplicitClick));
  assert.equal(afterExplicitClick.active, true, JSON.stringify(afterExplicitClick));
  assert.ok(afterExplicitClick.previewTop < 100, JSON.stringify(afterExplicitClick));

  await page.mouse.click(sourceTarget.x, sourceTarget.y);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(
    await page.evaluate(() => (
      document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop
    )),
    afterExplicitClick.previewTop,
    'A repeated click in the visible block must not move Preview'
  );

  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.45;
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const editingTarget = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    const bounds = scroller.getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
      .map(line => ({ line, rect: line.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= bounds.top && rect.bottom <= bounds.bottom);
    const candidate = lines[Math.max(0, Math.floor(lines.length * 0.75))]!;
    return { x: candidate.rect.left + 24, y: candidate.rect.top + candidate.rect.height / 2 };
  });
  await movePreviewToBottom();
  await page.mouse.click(editingTarget.x, editingTarget.y);
  await new Promise(resolve => setTimeout(resolve, 80));
  const attentionBefore = await page.evaluate(() => {
    const scope = window as any;
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const paragraphs = [...doc.querySelectorAll('p')].filter(node => /^Paragraph \d+/.test(node.textContent ?? '')
      && node.getBoundingClientRect().top >= 0 && node.getBoundingClientRect().bottom <= doc.documentElement.clientHeight);
    paragraphs.sort((a, b) => Math.abs(a.getBoundingClientRect().top - doc.documentElement.clientHeight / 3)
      - Math.abs(b.getBoundingClientRect().top - doc.documentElement.clientHeight / 3));
    const witness = paragraphs[0];
    if (!witness) throw new Error('A visible reading paragraph is required');
    const text = witness.textContent;
    scope.__attentionSamples = [];
    scope.__attentionSampling = true;
    const sample = () => {
      if (!scope.__attentionSampling) return;
      const current = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const node = [...current.querySelectorAll('p')].find(node => node.textContent === text);
      scope.__attentionSamples.push(node?.getBoundingClientRect().top ?? null);
      scope.__attentionRaf = requestAnimationFrame(sample);
    };
    scope.__attentionRaf = requestAnimationFrame(sample);
    return { text, top: witness.getBoundingClientRect().top };
  });
  await page.keyboard.type('x');
  await new Promise(resolve => setTimeout(resolve, 240));
  const previewTopAfterTyping = await page.evaluate(() => (
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop
  ));
  const attentionSamples = await page.evaluate(() => {
    const scope = window as any;
    scope.__attentionSampling = false;
    cancelAnimationFrame(scope.__attentionRaf);
    return scope.__attentionSamples as Array<number | null>;
  });
  // Adding a paragraph can change scrollTop while the reading anchor stays
  // fixed. Retain the actual visible text, including every input frame.
  assert.ok(
    attentionSamples.length >= 2 && attentionSamples.every(top => top !== null && Math.abs(top - attentionBefore.top) <= 2),
    `Typing after an explicit locate must retain the Preview attention position: ${JSON.stringify({ attentionBefore, attentionSamples })}`
  );

  const sourceScrollerPoint = await page.$eval('.cm-scroller', element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(sourceScrollerPoint.x, sourceScrollerPoint.y);
  await page.mouse.wheel({ deltaY: 240 });
  await new Promise(resolve => setTimeout(resolve, 120));
  const previewTopAfterSourceScroll = await page.evaluate(() => (
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop
  ));
  assert.ok(
    Math.abs(previewTopAfterSourceScroll - previewTopAfterTyping) > 2,
    'A deliberate Source scroll must release the attention hold and resume linked scrolling'
  );

  const previewBounds = await page.$eval('.preview-frame', element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + 80 };
  });
  await page.mouse.click(previewBounds.x, previewBounds.y);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(
    await page.evaluate(() => {
      const frameDocument = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const marker = frameDocument.querySelector('.meo-preview-source-position-marker');
      const cursor = frameDocument.querySelector<HTMLElement>('.meo-preview-source-position-cursor')!;
      return {
        active: marker?.classList.contains('is-active'),
        cursorDisplay: frameDocument.defaultView!.getComputedStyle(cursor).display,
        backgroundColor: frameDocument.defaultView!.getComputedStyle(marker!).backgroundColor,
        activeLineBackground: getComputedStyle(document.querySelector<HTMLElement>('.cm-activeLine')!).backgroundColor
      };
    }),
    {
      active: false,
      cursorDisplay: 'none',
      backgroundColor: markerPresentation.backgroundColor,
      activeLineBackground: markerPresentation.activeLineBackground
    }
  );

  await page.click('.source-preview-scroll-sync-button');
  assert.equal(
    await page.$eval('.source-preview-scroll-sync-button', button => button.getAttribute('aria-pressed')),
    'false'
  );
  const independentTop = await movePreviewToBottom();
  await new Promise(resolve => setTimeout(resolve, 40));
  await page.mouse.click(sourceTarget.x, sourceTarget.y);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(Math.abs(await page.evaluate(() => (
    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop
  )) - independentTop) <= 1, 'Independent panes must not auto-locate');

  const alignment = '.meo-preview-viewport-alignment';
  const toPreview = '[data-meo-align-viewport="preview"]';
  const toSource = '[data-meo-align-viewport="source"]';
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(() => {
    const view = (window as any).EditingSettingsHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
    const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!;
    return {
      sourceTop: view.scrollDOM.scrollTop, sourceLeft: view.scrollDOM.scrollLeft,
      previewTop: frame.contentDocument!.scrollingElement!.scrollTop,
      selection: view.state.selection.toJSON(), text: view.state.doc.toString(),
      focus: document.activeElement === view.contentDOM ? 'source' : document.activeElement === frame ? 'preview' : 'other'
    };
  });
  const geometry = () => page.$eval(alignment, element => {
    const rect = element.getBoundingClientRect();
    const frame = document.querySelector('.preview-frame')!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      dividerX: frame.left - 1, frameY: frame.top + frame.height / 2, width: rect.width, height: rect.height };
  });
  const buttons = await page.$$eval(alignment + ' button', buttons => buttons.map(button => ({
    width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
    iconWidth: button.querySelector('svg')!.getBoundingClientRect().width,
    hint: (button as HTMLElement).dataset.tooltip, label: button.getAttribute('aria-label'),
    disabled: (button as HTMLButtonElement).disabled
  })));
  assert.deepEqual(buttons.map(button => [button.width, button.height, button.iconWidth, button.disabled]), [[23, 23, 22, false], [23, 23, 22, false]]);
  assert.deepEqual(buttons.map(button => button.hint), ['Align to source', 'Align to preview']);
  assert.ok(buttons.every(button => button.hint === button.label));
  const fixed = await geometry();
  assert.ok(Math.abs(fixed.x - fixed.dividerX) <= 0.5 && Math.abs(fixed.y - fixed.frameY) <= 0.5, JSON.stringify(fixed));
  assert.equal(fixed.width, 26);
  assert.equal(fixed.height, 48);
  const circularTargets = await page.$$eval(alignment + ' button', buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    const hit = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('button') === button;
    return { width: rect.width, height: rect.height, center: hit(rect.left + rect.width / 2, rect.top + rect.height / 2),
      corner: hit(rect.left + 1, rect.top + 1), leftEdge: hit(rect.left + 1, rect.top + rect.height / 2) };
  }));
  assert.ok(circularTargets.every(target => target.width === target.height && target.center && target.leftEdge && !target.corner), 'alignment hit targets must be circles rather than rectangular halves');
  assert.equal(await page.$('.meo-preview-source-navigation'), null, 'the moving locator is removed');

  // The Source caret deliberately stays far away from its visible reading position.
  const expectedPreviewTop = await page.evaluate(() => {
    const view = (window as any).EditingSettingsHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const target = [...doc.querySelectorAll<HTMLElement>('h2[data-source-line]')].find(element => element.textContent === 'Section 45')!;
    view.dispatch({ selection: { anchor: view.state.doc.line(5).from, head: view.state.doc.line(5).to } });
    view.focus();
    view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(Number(target.dataset.sourceLine)).from).top;
    return target.getBoundingClientRect().top + doc.scrollingElement!.scrollTop;
  });
  await settle();
  // The first distant scroll measures wrapped Source lines; place the fixture
  // at the now-measured heading before checking an exact semantic destination.
  await page.evaluate(() => {
    const view = (window as any).EditingSettingsHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const target = [...doc.querySelectorAll<HTMLElement>('h2[data-source-line]')].find(element => element.textContent === 'Section 45')!;
    view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(Number(target.dataset.sourceLine)).from).top;
  });
  await settle();
  const sourceBefore = await snapshot();
  await page.click(toPreview);
  await settle();
  const sourceAfter = await snapshot();
  assert.deepEqual({ ...sourceAfter, previewTop: sourceBefore.previewTop }, sourceBefore, 'right arrow changes only Preview, retaining Source focus/selection/viewport/text');
  assert.ok(Math.abs(sourceAfter.previewTop - expectedPreviewTop) <= 3, JSON.stringify({ actual: sourceAfter.previewTop, expectedPreviewTop }));
  assert.equal(await page.$eval('.source-preview-scroll-sync-button', element => element.getAttribute('aria-pressed')), 'false');
  await page.click(toPreview);
  await settle();
  assert.deepEqual(await snapshot(), sourceAfter, 'repeated alignment is stable');
  await page.mouse.move(10, 10);
  assert.deepEqual(await geometry(), fixed, 'caret, hover and scroll do not move or hide the controls');
  assert.equal(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.querySelector('.meo-preview-source-navigation-highlight')), null);

  const expectedSourceTop = await page.evaluate(() => {
    const view = (window as any).EditingSettingsHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
    const scroll = doc.scrollingElement!;
    const target = [...doc.querySelectorAll<HTMLElement>('h2[data-source-line]')].find(element => element.textContent === 'Section 15')!;
    scroll.scrollTop += target.getBoundingClientRect().top;
    doc.body.focus({ preventScroll: true });
    return view.lineBlockAt(view.state.doc.line(Number(target.dataset.sourceLine)).from).top;
  });
  await settle();
  const previewBefore = await snapshot();
  await page.click(toSource);
  await settle();
  const previewAfter = await snapshot();
  assert.deepEqual({ ...previewAfter, sourceTop: previewBefore.sourceTop }, previewBefore, 'left arrow changes only Source vertical scroll, retaining Preview focus and Source selection');
  assert.ok(Math.abs(previewAfter.sourceTop - expectedSourceTop) <= 3, JSON.stringify({ previewAfter, expectedSourceTop }));
  assert.ok(Math.abs(previewAfter.sourceTop - previewBefore.sourceTop) > 500, 'left arrow must move the distant Source viewport');

  // Subsequent scrolls stay independent; the one-shot action cannot enable linkage.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop += 100;
  });
  await settle();
  assert.equal((await snapshot()).previewTop, previewAfter.previewTop);
  const independentSource = (await snapshot()).sourceTop;
  await page.evaluate(() => { document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop += 140; });
  await settle();
  assert.equal((await snapshot()).sourceTop, independentSource);
  await page.focus(toSource);
  const keyboardBefore = await snapshot();
  await page.keyboard.press('Enter');
  await settle();
  const keyboardAfter = await snapshot();
  assert.equal(keyboardAfter.text, keyboardBefore.text);
  assert.deepEqual(keyboardAfter.selection, keyboardBefore.selection);
  assert.equal(keyboardAfter.previewTop, keyboardBefore.previewTop);
  assert.equal(await page.$eval(toSource, button => button === document.activeElement), true, 'keyboard activation retains its button focus');

  // Each direction also handles the document boundaries without moving its origin.
  for (const boundary of [0, 1]) {
    const sourceBounds = await page.$eval('.cm-scroller', element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(sourceBounds.x, sourceBounds.y);
    // A new native gesture retires the preceding alignment's finite layout
    // correction before preparing an exact boundary fixture.
    await page.mouse.wheel({ deltaY: boundary ? 100_000 : -100_000 });
    await page.evaluate(boundary => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
      scroller.scrollTop = boundary * (scroller.scrollHeight - scroller.clientHeight);
    }, boundary);
    await settle();
    await page.click(toPreview);
    await settle();
    const remainingPreview = await page.evaluate(boundary => {
      const scroll = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!;
      return Math.abs(scroll.scrollTop - boundary * (scroll.scrollHeight - scroll.clientHeight));
    }, boundary);
    assert.ok(remainingPreview <= 2, 'Source boundary aligns Preview boundary: ' + remainingPreview);
    await page.evaluate(boundary => {
      const scroll = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!;
      scroll.scrollTop = (1 - boundary) * (scroll.scrollHeight - scroll.clientHeight);
    }, boundary);
    await settle();
    await page.click(toSource);
    await settle();
    const remainingSource = await page.$eval('.cm-scroller', (element, boundary) => {
      return Math.abs(element.scrollTop - (1 - boundary) * (element.scrollHeight - element.clientHeight));
    }, boundary);
    assert.ok(remainingSource <= 2, 'Preview boundary aligns Source boundary: ' + remainingSource);
  }
  await page.hover(toPreview);
  await page.waitForFunction(() => document.querySelector('.meo-tooltip.is-visible')?.textContent?.includes('Align to source'));
  const hintPosition = await page.$eval('.meo-tooltip.is-visible', element => element.getBoundingClientRect().toJSON());
  const buttonRect = await page.$eval(toPreview, element => element.getBoundingClientRect().toJSON());
  await page.mouse.move(buttonRect.left + 6, buttonRect.top + 6);
  await settle();
  const movedHint = await page.$eval('.meo-tooltip.is-visible', element => element.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(movedHint.x - hintPosition.x) <= 0.5 && Math.abs(movedHint.y - hintPosition.y) <= 0.5, 'tooltips stay anchored to the button');

  let releasePreviewRender!: () => void;
  previewRenderGate = new Promise(resolve => { releasePreviewRender = resolve; });
  await page.evaluate(() => {
    const view = (window as any).EditingSettingsHarness.EditorView.findFromDOM(document.querySelector('.editor-host > .cm-editor'));
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\nFresh render check' } });
  });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.meo-preview-viewport-align-button')].every(button => button.disabled));
  const staleViews = await snapshot();
  await page.$eval(toPreview, element => (element as HTMLButtonElement).click());
  await settle();
  assert.deepEqual(await snapshot(), staleViews, 'an outdated Preview cannot move either view');
  releasePreviewRender();
  previewRenderGate = null;
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.meo-preview-viewport-align-button')!.disabled
    && document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.body.textContent?.includes('Fresh render check'));

  // Resuming automatic sync follows the last manual action's origin (Preview).
  await page.click(toSource);
  await settle();
  const resumeOrigin = await snapshot();
  await page.evaluate(() => { document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop -= 100; });
  await settle();
  await page.click('.source-preview-scroll-sync-button');
  await settle();
  assert.equal(await page.$eval(alignment, element => (element as HTMLElement).hidden), true, 'automatic sync hides both manual actions');
  const resumed = await snapshot();
  assert.ok(Math.abs(resumed.sourceTop - resumeOrigin.sourceTop) <= 2 && resumed.previewTop === resumeOrigin.previewTop, 'resuming sync retains the last manual origin');
  await page.click('.source-preview-scroll-sync-button');
  assert.equal(await page.$eval(alignment, element => (element as HTMLElement).hidden), false);
  await page.click('button[data-mode="preview"]');
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#app')?.dataset.mode === 'preview');
  assert.equal(await page.$eval(alignment, element => (element as HTMLElement).hidden), true, 'full Preview has no divider actions');
  }
} catch (error) {
  primaryError = error;
} finally {
  if (primaryError === undefined) await closeTestBrowser(browser);
  else await closeTestBrowser(browser, primaryError);
}

console.log('Source position marker checks passed');

async function assertMarkerPrecision(page: import('puppeteer-core').Page, bundle: string, windowed: boolean): Promise<void> {
  const fixture = ['# Precision', '', '- Parent item', '  - Child item', '- Sibling item', '',
    'First **paragraph** line.', 'Second *paragraph* line.', '', '```text', 'alpha', '', 'omega', '```', '',
    'Reference[^n].', '', '[^n]: Note first.', '', '    - Note parent', '      - Note child', '',
    '    ```text', '    note alpha', '    ', '    note omega', '    ```', '',
    '    | Key | Value |', '    | --- | --- |', '    | n | 1 |', '', '    $$', '    x+y', '    $$', '',
    '---', '', '<div id="empty"></div>', 'Visible HTML tail', '',
    '| Header | Value |', '| --- | --- |', '| Data | 1 |', '',
    '<details>', '<summary>Folded</summary>', '', 'Inside folded.', '', '</details>', '', '<!-- Hidden -->', '',
    '- Composite parent', '', '  ```text', '  nested code', '  ```', '', '  Continuation.', '', '```text', '```', '',
    '## Boundary variants', '', '1. Quoted code', '   > ```js', '   > quoted alpha', '   >', '   > quoted omega', '   > ```', '',
    '~~~', 'tilde body', '~~~~', '', '    indented alpha', '    indented omega'];
  const text = fixture.join('\n') + '\n\n' + Array.from({ length: windowed ? 5000 : 2 }, (_, i) => `Paragraph ${i}.\n\n`).join('');
  assert.equal(assessLargeDocument(text).windowedPreview, windowed);
  const documents = new Map<string, ReturnType<typeof createPreviewDocument>>();
  try {
    await page.setViewport({ width: 700, height: 900 });
    await page.exposeFunction('__markerPrecisionHost', async (m: any) => {
      if (m.type === 'requestPreviewRender') {
        assert.equal(Boolean(m.window), windowed);
        const options = { markdownText: m.text, sourceDocumentPath: '/fixture/precision.md', uiLanguage: 'en' as const, layout: m.layout };
        const parsed = m.window ? createPreviewDocument(m.requestId, options) : undefined;
        if (parsed) documents.set(m.requestId, parsed);
        return { type: 'previewRenderResult', requestId: m.requestId, result: { ok: true,
          value: parsed ? parsed.open(m.window.anchorLine) : exportRuntime.renderPreviewDocument(options) } };
      }
      if (m.type === 'requestPreviewDocument') return { type: 'previewDocumentResult', requestId: m.requestId,
        documentId: m.documentId, result: { ok: true, value: await documents.get(m.documentId)!.run(m.operation) } };
      return null;
    });
    await page.setContent('<!doctype html><style>html,body{height:100%;margin:0}.preview-host:not([hidden]){height:100%;display:flex;flex-direction:column}.preview-frame{width:100%;height:100%;flex:1}</style><body style="background:#121314"></body>');
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(text => {
      const w = window as any, c = w.__previewController;
      w.__previewHostMessage = (m: unknown) => w.__markerPrecisionHost(m).then((response: any) => {
        if (response?.type === 'previewRenderResult') c.acceptRenderResponse(response);
        if (response?.type === 'previewDocumentResult') c.acceptDocumentResponse(response);
      });
      c.setLayout('full'); c.setSourcePreviewControls(true); c.setSourceColoring(false); c.setVisible(true);
      void c.requestRender(text);
    }, text);
    await page.waitForFunction(() => (window as any).__previewRenderedAt && document.querySelector<HTMLIFrameElement>('iframe')?.contentDocument?.querySelector('.meo-export-code-line-source'));
    await page.evaluate(text => {
      (window as any).__precisionCodeWitness = document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument!.querySelector('.meo-export-code-line-source');
      const c = (window as any).__previewController;
      c.setLayout('side'); void c.requestRender(text, { force: true });
    }, text);
    await page.waitForFunction(() => {
      const d = document.querySelector<HTMLIFrameElement>('iframe')?.contentDocument;
      return d?.documentElement.dataset.meoPreviewLayout === 'side' && d.querySelector('.meo-preview-source-footnote');
    });
    assert.ok(await page.evaluate(() => (window as any).__precisionCodeWitness === document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument!.querySelector('.meo-export-code-line-source')),
      'Full-to-side mapping updates retain the accepted literal code DOM');
    const projections = await page.evaluate(lines => {
      const c = (window as any).__previewController, d = document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument!;
      return lines.map((source, index) => {
        c.setSourcePositionMarker({ visible: true, active: true, line: index + 1 });
        const m = d.querySelector<HTMLElement>('.meo-preview-source-position-marker')!, r = m.getBoundingClientRect();
        return { line: index + 1, source, visible: !m.hidden, top: r.top, bottom: r.bottom, height: r.height };
      });
    }, fixture);
    const at = (source: string) => projections.find(row => row.source === source)!;
    assert.ok(at('- Parent item').bottom <= at('  - Child item').top + 1, 'Parent text must exclude its child list');
    assert.ok(at('    - Note parent').bottom <= at('      - Note child').top + 1, 'Footnote list text must exclude its child');
    assert.ok(at('First **paragraph** line.').bottom <= at('Second *paragraph* line.').top + 1, 'Multiline prose maps each actual text range');
    assert.ok(at('alpha').bottom <= at('omega').top - 1 && at('alpha').height < 30, 'Code targets one reading row');
    assert.ok(at('    note alpha').height < 30 && at('    note alpha').top > at('[^n]: Note first.').bottom, 'Footnote code has its own source row');
    assert.ok(at('  nested code').height < 30, 'Equivalent outer lists also update their retained code-row mappings');
    assert.ok(at('```text').height < 30 && at('```').height < 30, 'Fence delimiters locate a boundary rather than the entire code block');
    assert.ok(at('```text').bottom <= at('alpha').top + 1 && at('```').top >= at('omega').bottom - 1,
      'Opening and closing fences locate distinct top and bottom boundaries');
    for (const source of ['---', 'Visible HTML tail', '```text', '```', '    ```', '</details>']) assert.ok(at(source).visible, `${windowed}: ${source} has a visible result`);
    assert.ok(at('---').height >= 14, 'A thin horizontal rule has a discernible reading-line highlight');
    for (const source of ['| --- | --- |', '    | --- | --- |', '<!-- Hidden -->']) assert.equal(at(source).visible, false, `${source} has no independent reading position`);
    assert.ok(projections[11]!.visible && projections[24]!.visible, 'Empty literal code rows retain a real reading position');
    const emptyFenceIndex = fixture.findIndex((source, index) => source === '```text' && fixture[index + 1] === '```');
    const emptyStart = projections[emptyFenceIndex]!, emptyEnd = projections[emptyFenceIndex + 1]!;
    assert.ok(emptyStart.visible && emptyEnd.visible && emptyStart.height < 30 && emptyEnd.height < 30
      && emptyStart.bottom <= emptyEnd.top + 1, 'An empty code block retains distinct fence boundaries');
    assert.ok(at('    ```text').height < 30 && at('    ```').height < 30
      && at('    ```').top >= at('    note omega').bottom - 1, 'Footnote fences retain their own boundaries');
    assert.ok(at('   > ```js').height < 30 && at('   > ```').height < 30
      && at('   > ```js').bottom <= at('   > quoted alpha').top + 1
      && at('   > ```').top >= at('   > quoted omega').bottom - 1, 'Quoted fences inside a list have independent boundaries');
    assert.ok(at('~~~').height < 30 && at('~~~~').height < 30, 'Tilde fences use the same boundary geometry');
    assert.ok(at('    indented alpha').height < 30 && at('    indented omega').height < 30
      && at('    indented alpha').bottom <= at('    indented omega').top + 1, 'Indented code retains actual content rows');
    const math = [at('    $$'), at('    x+y')];
    assert.ok(math.every(row => row.visible));
    assert.equal(math[0]!.top, math[1]!.top, 'Math remains one atomic reading result');
    assert.equal(await page.$eval('iframe', e => (e as HTMLIFrameElement).contentDocument!.documentElement.dataset.meoPreviewWindowed === 'true'), windowed);
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(appearance => {
        const c = (window as any).__previewController; c.setAppearance(appearance);
        c.setSourcePositionMarker({ visible: true, active: true, line: 24 }, { revealIfOutside: true });
      }, appearance);
      await page.evaluate(async () => { for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame); });
      const clip = await page.evaluate(() => {
        const f = document.querySelector<HTMLIFrameElement>('iframe')!, d = f.contentDocument!, fr = f.getBoundingClientRect();
        const row = [...d.querySelectorAll<HTMLElement>('.meo-export-code-line-source')].find(e => e.textContent === 'note alpha')!, r = row.getBoundingClientRect();
        return { left: Math.ceil(fr.left + r.left), top: Math.ceil(fr.top + r.top), width: Math.floor(r.width), height: Math.floor(r.height) };
      });
      const before = await sharp(await page.screenshot()).extract(clip).raw().toBuffer();
      await page.evaluate(() => (window as any).__previewController.setSourcePositionMarker({ visible: false, active: true, line: 24 }));
      const after = await sharp(await page.screenshot()).extract(clip).raw().toBuffer();
      assert.notDeepEqual(before, after, `${windowed}/${appearance}: the code background must not hide the position overlay`);
      if (process.env.MEO_TEST_SCREENSHOTS) {
        await page.evaluate(() => (window as any).__previewController.setSourcePositionMarker({ visible: true, active: true, line: 24 }));
        await page.screenshot({ path: `${process.env.MEO_TEST_SCREENSHOTS}/marker-precision-${windowed}-${appearance}.png` });
      }
    }
    const lateLayout = await page.evaluate(() => {
      const c = (window as any).__previewController, d = document.querySelector<HTMLIFrameElement>('iframe')!.contentDocument!;
      c.setSourcePositionMarker({ visible: true, active: true, line: 24 }, { revealIfOutside: true });
      const row = [...d.querySelectorAll('.meo-export-code-line-source')].find(e => e.textContent === 'note alpha')!;
      const before = row.getBoundingClientRect().top;
      const restore = c.captureVisualReadingAnchor(1 / 3, 24);
      const earlier = d.querySelector<HTMLElement>('.meo-export-code-block-wrap')!;
      earlier.style.paddingBottom = '400px';
      const restored = restore?.() === true, after = row.getBoundingClientRect().top;
      earlier.style.paddingBottom = '';
      return { before, after, restored };
    });
    assert.ok(lateLayout.restored && Math.abs(lateLayout.before - lateLayout.after) <= 1,
      `Late layout above a located row must preserve its actual visible text: ${JSON.stringify(lateLayout)}`);
    console.log(`Source marker precision passed (${windowed ? 'windowed' : 'ordinary'})`);
  } finally { for (const d of documents.values()) d.dispose(); await page.close(); }
}

async function assertMarkerContinuity(page: import('puppeteer-core').Page, bundle: string, windowed: boolean, imageAbove: boolean, navigationOnly = false): Promise<void> {
  const prefix = imageAbove ? Array.from({ length: 40 }, (_, index) => `Before image ${index}: upstream context.\n\n`).join('')
    + '![Offscreen image](marker-image.svg)\n\n'
    + Array.from({ length: 40 }, (_, index) => `After image ${index}: upstream context.\n\n`).join('') : '';
  const lineOffset = prefix.split('\n').length - 1;
  const text = prefix + '# Position continuity\n\n- Typing target.\n- Neighbor item.\n\nFollowing paragraph.\n\n```text\nAlpha\n\nOmega\n```\n\n<!-- Hidden navigation target -->\n\n'
    + Array.from({ length: windowed ? 5000 : navigationOnly ? 50 : 10 }, (_, index) => `Paragraph ${index} with stable reading context.\n\n`).join('');
  assert.equal(assessLargeDocument(text).windowedPreview, windowed);
  const label = `${windowed ? 'windowed' : 'ordinary'}${imageAbove ? ', image above' : ''}`;
  const documents = new Map<string, ReturnType<typeof createPreviewDocument>>();
  let renderGate: Promise<void> | null = null;
  let releaseRender: (() => void) | undefined;
  const holdRender = () => { renderGate = new Promise(resolve => { releaseRender = resolve; }); };
  const resumeRender = () => { releaseRender?.(); renderGate = null; };
  try {
    await page.setViewport({ width: 1100, height: 720 });
    await page.exposeFunction('__markerContinuityHost', async (message: any) => {
      if (message.type === 'resolveImageSrc') return { type: 'resolvedImageSrc', requestId: message.requestId, result: { ok: true,
        value: { resolvedUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="361" height="190"><rect width="361" height="190" fill="#789"/></svg>') } } };
      if (message.type === 'applyChanges') return { type: 'applied', version: message.baseVersion + 1 };
      if (message.type === 'requestPreviewRender') {
        await renderGate;
        assert.equal(Boolean(message.window), windowed, `${label}: production Preview policy`);
        const options = { layout: message.layout, markdownText: message.text, sourceDocumentPath: '/fixture/marker.md',
          uiLanguage: message.uiLanguage, styleEnvironment: message.environment };
        const parsed = windowed ? createPreviewDocument(message.requestId, options) : undefined;
        if (parsed) documents.set(message.requestId, parsed);
        return { type: 'previewRenderResult', requestId: message.requestId, result: { ok: true,
          value: parsed ? parsed.open(message.window.anchorLine) : exportRuntime.renderPreviewDocument(options) } };
      }
      if (message.type === 'requestPreviewDocument') return { type: 'previewDocumentResult', requestId: message.requestId,
        documentId: message.documentId, result: { ok: true, value: await documents.get(message.documentId)!.run(message.operation) } };
      return null;
    });
    await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.addScriptTag({ content: `window.__markerMessages=[];window.acquireVsCodeApi=()=>({getState(){return {}},setState(){},postMessage(message){window.__markerMessages.push(message.type);window.__markerContinuityHost(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent('message',{data:response}));});}});` });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(({ text, imageAbove }) => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'init', documentId: 'file:///marker-continuity.md', text, version: 1, savedRevision: { version: 1, text },
      diagnostics: [], mode: 'source', uiLanguage: 'en', sourceLineNumbers: 'on', previewAppearance: 'dark',
      previewFontFamily: '', previewSourceColoring: true, editorAppearance: 'dark', editorFontSizeMode: 'auto', editorFontSize: 14,
      gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false, diffBaselineMode: 'current-edit',
      fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
      findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: false, outlineWidth: 260,
      restoreReadingPositionOnOpen: false, vscodeTheme: null,
      imageIntrinsicSizes: imageAbove ? [{ src: 'marker-image.svg', width: 361, height: 190 }] : []
    } })), { text, imageAbove });
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLElement>('.source-preview-button');
      return button?.offsetParent !== null && button && getComputedStyle(button).visibility === 'visible';
    });
    if (imageAbove) {
      await page.locator('.line-jump-input').fill(String(3 + lineOffset));
      await page.keyboard.press('Enter');
    }
    await page.click('.source-preview-button');
    await page.waitForFunction(windowed => {
      const host = document.querySelector<HTMLElement>('.preview-host');
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
      return host?.inert === false && getComputedStyle(host).visibility !== 'hidden'
        && document.querySelector<HTMLElement>('.preview-loading')?.hidden === true
        && doc?.body.textContent?.includes('Typing target.') && Boolean(doc.querySelector('[data-meo-preview-document]')) === windowed;
    }, {}, windowed);
    if (imageAbove && !windowed) assert.ok(await page.evaluate(() => [...document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.images]
      .some(image => image.hasAttribute('data-meo-deferred-image-src') && image.width === 361 && image.height === 190 && image.naturalWidth <= 1)),
    'the upstream image must retain known dimensions without loading its offscreen bitmap');
    const selectLine = async (line: number) => {
      await page.evaluate(line => {
        const view = (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view;
        view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
        view.focus();
      }, line + lineOffset);
      await page.evaluate(async () => { for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame); });
    };
    if (navigationOnly) {
      const previewTop = () => page.$eval('.preview-frame', e => (e as HTMLIFrameElement).contentDocument!.scrollingElement!.scrollTop);
      const movePreviewAway = async () => {
        await page.evaluate(() => {
          document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.scrollingElement!.scrollTop = 500;
        });
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.ok(await page.$eval('.preview-frame', e => (e as HTMLIFrameElement).contentDocument!
          .querySelector('.meo-preview-source-position-marker')!.getBoundingClientRect().bottom < 0), 'Navigation fixture starts with an offscreen Preview target');
      };
      const waitForVisibleMarker = (line: number) => page.waitForFunction(line => {
        const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
        const marker = doc.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
        const r = marker.getBoundingClientRect();
        return Number(marker.dataset.meoSourcePositionLine) === line && !marker.hidden && r.bottom > 0 && r.top < doc.documentElement.clientHeight;
      }, { timeout: 3000 }, line);
      for (const [line, key, expectedLine] of [[3, 'ArrowDown', 4], [4, 'ArrowUp', 3], [3, 'Home', 3], [3, 'ArrowLeft', 3]] as const) {
        await selectLine(line);
        await movePreviewAway();
        await page.keyboard.press(key);
        await waitForVisibleMarker(expectedLine);
      }
      const visibleTop = await previewTop();
      await page.keyboard.press('ArrowLeft');
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.ok(Math.abs(await previewTop() - visibleTop) <= 1, 'Moving within a visible target does not scroll Preview');
      await selectLine(3);
      await movePreviewAway();
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');
      await waitForVisibleMarker(4);
      assert.ok(await page.evaluate(() => !(document.querySelector('.editor-host .cm-content') as any).cmTile.root.view.state.selection.main.empty),
        'Shift navigation preserves the native text selection');

      await selectLine(3);
      await movePreviewAway();
      const beforeInput = await previewTop();
      await page.keyboard.type('x');
      await new Promise(resolve => setTimeout(resolve, 240));
      assert.ok(Math.abs(await previewTop() - beforeInput) <= 2, 'Typing does not become a new cross-pane navigation');
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');
      await new Promise(resolve => setTimeout(resolve, 160));
      assert.ok(Math.abs(await previewTop() - beforeInput) <= 2, 'Undo does not become keyboard selection navigation');

      await selectLine(3);
      await movePreviewAway();
      const beforeComposition = await previewTop();
      assert.ok(await page.evaluate(() => {
        const v = (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view;
        (v.contentDOM.editContext ?? v.contentDOM).dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        const composing = v.compositionStarted;
        v.dispatch({ selection: { anchor: v.state.doc.line(4).to }, userEvent: 'select' });
        return composing;
      }), 'The IME negative control exercises active composition');
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.ok(Math.abs(await previewTop() - beforeComposition) <= 1, 'Composition selection does not become keyboard navigation');
      await page.$eval('.cm-content', e => ((e as any).editContext ?? e).dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.waitForFunction(() => !(document.querySelector('.editor-host .cm-content') as any).cmTile.root.view.compositionStarted);

      await page.keyboard.down('Control');
      await page.keyboard.press('End');
      await page.keyboard.up('Control');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      const tailLine = await page.evaluate(() => (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view.state.doc.lines - 2);
      await waitForVisibleMarker(tailLine);
      await page.keyboard.down('Control');
      await page.keyboard.press('Home');
      await page.keyboard.up('Control');
      await waitForVisibleMarker(1);

      await page.click('.source-preview-scroll-sync-button');
      await selectLine(3);
      await movePreviewAway();
      const independentTop = await previewTop();
      await page.keyboard.press('ArrowDown');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(Math.abs(await previewTop() - independentTop) <= 1, 'Keyboard navigation respects independent scrolling');
      console.log(`Source keyboard marker reveal passed (${label})`);
      return;
    }
    const markerSnapshot = () => page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const marker = doc.querySelector<HTMLElement>('.meo-preview-source-position-marker')!;
      const rect = marker.getBoundingClientRect();
      return { hidden: marker.hidden, line: Number(marker.dataset.meoSourcePositionLine), top: rect.top, height: rect.height,
        connected: marker === (window as any).__markerWitness, duplicates: doc.querySelectorAll('.meo-preview-source-position-marker').length };
    });
    await selectLine(3);
    await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const marker = (window as any).__markerWitness = doc.querySelector('.meo-preview-source-position-marker');
      const probe = (window as any).__markerProbe = { running: true, missing: 0, removed: 0, frames: 0, misaligned: 0, deltas: [] as number[] };
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes)
          if (node === marker || node.contains(marker)) probe.removed++;
      });
      observer.observe(doc.querySelector('main')!, { childList: true, subtree: true });
      probe.observer = observer;
      const sample = () => {
        probe.frames++;
        if (!marker.isConnected || (marker as HTMLElement).hidden) probe.missing++;
        const target = [...doc.querySelectorAll('li')].find(element => element.textContent?.includes('Typing target.'));
        const delta = target ? marker.getBoundingClientRect().top - target.getBoundingClientRect().top : Infinity;
        if (Math.abs(delta) > 0.5) { probe.misaligned++; probe.deltas.push(delta); }
        if (probe.running) requestAnimationFrame(sample);
      };
      sample();
    });
    const before = await markerSnapshot();
    assert.equal(before.hidden, false);
    const pixelPoint = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!;
      const rect = frame.contentDocument!.querySelector('.meo-preview-source-position-marker')!.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      return { x: Math.floor(frameRect.right - 25), y: Math.floor(frameRect.top + rect.top + rect.height / 2) };
    });
    const pixelColor = async (bytes: Buffer | Uint8Array) => {
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.ok(pixelPoint.x >= 0 && pixelPoint.x < info.width && pixelPoint.y >= 0 && pixelPoint.y < info.height);
      const offset = (pixelPoint.y * info.width + pixelPoint.x) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };
    const baseline = await pixelColor(await page.screenshot());
    const expectedColor = await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      const canvas = doc.createElement('canvas'), context = canvas.getContext('2d')!;
      context.fillStyle = doc.defaultView!.getComputedStyle(doc.documentElement).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = doc.defaultView!.getComputedStyle(doc.body).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = doc.defaultView!.getComputedStyle(doc.querySelector('.meo-export-page')!).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = doc.defaultView!.getComputedStyle(doc.querySelector('.meo-preview-source-position-marker')!).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
    assert.deepEqual(baseline, expectedColor, `${label}: the sampled pixel must actually paint the position background`);
    const client = await page.createCDPSession();
    const paints: string[] = [];
    client.on('Page.screencastFrame', event => { paints.push(event.data); void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }); });
    await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    try {
      await page.keyboard.type('xy', { delay: 450 });
      await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.body.textContent?.includes('Typing target.xy'));
      await page.evaluate(async () => { for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame); });
    } finally {
      await client.send('Page.stopScreencast');
      await client.detach();
    }
    const probe = await page.evaluate(() => {
      const probe = (window as any).__markerProbe;
      probe.running = false; probe.observer.disconnect();
      return { removed: probe.removed, missing: probe.missing, frames: probe.frames, misaligned: probe.misaligned, deltas: probe.deltas };
    });
    assert.equal(probe.removed, 0, `${label}: updating list text must not discard the accepted position overlay`);
    assert.equal(probe.missing, 0, `${label}: every input frame retains the position highlight`);
    assert.equal(probe.misaligned, 0, `${label}: every input frame highlights the actual item ${JSON.stringify(probe.deltas)}`);
    assert.ok(probe.frames > 10);
    assert.deepEqual(await markerSnapshot(), before, `${label}: typing retains the same visible position overlay and geometry`);
    assert.ok(paints.length >= 2, `${label}: compositor evidence is required`);
    for (const paint of paints) assert.deepEqual(await pixelColor(Buffer.from(paint, 'base64')), baseline, `${label}: every painted input frame retains the background`);

    // A new cursor destination owns visibility; whitespace is not itself a rule:
    // an empty code line renders, whereas a gap and a hidden comment do not.
    // Markdown's final list item includes its trailing blank in its block range.
    // The separate gap before the fence has no such rendered owner.
    await selectLine(7);
    assert.equal((await markerSnapshot()).hidden, true, `${label}: an unmapped blank line hides the overlay`);
    await selectLine(10);
    assert.equal((await markerSnapshot()).hidden, false, `${label}: an empty code line still has a rendered target`);
    await selectLine(14);
    assert.equal((await markerSnapshot()).hidden, true, `${label}: a hidden comment has no rendered target`);
    await selectLine(4);
    const neighbor = await markerSnapshot();
    assert.equal(neighbor.hidden, false);
    assert.equal(neighbor.connected, true);
    assert.ok(neighbor.top > before.top, `${label}: navigation moves the retained overlay to the new item`);

    await selectLine(3);
    const requestCount = () => page.evaluate(() => (window as any).__markerMessages.filter((type: string) => type === 'requestPreviewRender').length);
    const requestsBeforeTyping = await requestCount();
    holdRender();
    await page.keyboard.type('z');
    await page.waitForFunction(before => (window as any).__markerMessages.filter((type: string) => type === 'requestPreviewRender').length > before,
      {}, requestsBeforeTyping);
    assert.deepEqual(await markerSnapshot(), before, `${label}: a pending render retains the accepted highlight`);
    await selectLine(7);
    assert.deepEqual(await markerSnapshot(), before, `${label}: stale source coordinates cannot retarget the accepted reading revision`);
    resumeRender();
    await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.body.textContent?.includes('Typing target.xyz'));
    assert.equal((await markerSnapshot()).hidden, true, `${label}: the latest unmapped selection wins when the pending revision is accepted`);
    await selectLine(3);

    holdRender();
    const requestsBeforeLineShift = await requestCount();
    await page.evaluate(() => {
      const view = (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view;
      view.dispatch({ changes: { from: 0, insert: '\n' } });
    });
    await page.waitForFunction(before => (window as any).__markerMessages.filter((type: string) => type === 'requestPreviewRender').length > before,
      {}, requestsBeforeLineShift);
    assert.deepEqual(await markerSnapshot(), before, `${label}: inserting a source line retains the old accepted coordinates until commit`);
    resumeRender();
    await page.waitForFunction(line => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      .querySelector<HTMLElement>('.meo-preview-source-position-marker')?.dataset.meoSourcePositionLine === String(line), {}, before.line + 1);
    assert.deepEqual(await markerSnapshot(), { ...before, line: before.line + 1 }, `${label}: the same visible block accepts its shifted source line atomically`);
    await page.evaluate(() => {
      const view = (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view;
      view.dispatch({ changes: { from: 0, to: 1, insert: '' } });
    });
    await page.waitForFunction(line => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      .querySelector<HTMLElement>('.meo-preview-source-position-marker')?.dataset.meoSourcePositionLine === String(line), {}, before.line);

    // Removing the current block really removes its mapping on acceptance.
    const requestsBeforeRemoval = await requestCount();
    holdRender();
    await page.evaluate(line => {
      const view = (document.querySelector('.editor-host .cm-content') as any).cmTile.root.view;
      const target = view.state.doc.line(line);
      view.dispatch({ changes: { from: target.from, to: target.to, insert: '' }, selection: { anchor: target.from } });
    }, 3 + lineOffset);
    await page.waitForFunction(before => (window as any).__markerMessages.filter((type: string) => type === 'requestPreviewRender').length > before,
      {}, requestsBeforeRemoval);
    assert.equal((await markerSnapshot()).hidden, false, `${label}: the old reading DOM remains highlighted until replacement`);
    resumeRender();
    await page.waitForFunction(() => !document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!.body.textContent?.includes('Typing target'));
    assert.equal((await markerSnapshot()).hidden, true, `${label}: an accepted blank destination removes the highlight`);
    assert.equal((await markerSnapshot()).duplicates, 1);
    await selectLine(4);
    assert.equal((await markerSnapshot()).hidden, false);
    if (windowed) {
      if (await page.$eval('.source-preview-scroll-sync-button', button => button.getAttribute('aria-pressed')) === 'true')
        await page.click('.source-preview-scroll-sync-button');
      assert.ok(await page.evaluate(() => [...document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
        .querySelectorAll<HTMLElement>('[data-meo-preview-gap]')].some(gap => Number(gap.dataset.sourceLine) <= 4000 && Number(gap.dataset.sourceEndLine) >= 4000)),
      'the offscreen destination must really be an unloaded Preview band');
      await selectLine(4000);
      assert.equal((await markerSnapshot()).hidden, true, 'an unloaded window gap is not rendered content to highlight');
      await selectLine(4);
      assert.equal((await markerSnapshot()).hidden, false, 'returning to mounted content restores the same overlay');
    }
    await page.click('button[data-mode="preview"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#app')?.dataset.mode === 'preview'
      && document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.documentElement.dataset.meoPreviewLayout === 'full'
      && document.querySelector<HTMLElement>('.preview-host')?.inert === false);
    assert.equal(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      .querySelector('.meo-preview-source-position-marker')), null, `${label}: full Preview releases the Source-only overlay`);
    console.log(`Source position continuity (${label}): ${probe.frames} input frames, ${paints.length} compositor paints, mapped/empty destinations`);
  } finally {
    resumeRender();
    for (const parsed of documents.values()) parsed.dispose();
    await page.close();
  }
}
