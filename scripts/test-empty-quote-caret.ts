import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';

const root = path.resolve(import.meta.dir, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-empty-quote-caret-'));

async function assertHeldQuoteCarets(page: import('puppeteer-core').Page): Promise<void> {
  const caretStyle = await page.addStyleTag({ content: '.cm-editor{--meo-caret-color:#ff00ff!important}.cm-content{caret-animation:manual}' });
  const fixtures = [
    { text: '>\n', line: 1 },
    ...['>', '> ', '>>', '> >', '> > ', '>>>', '>   >', '  >\t>\t', '- >', '> - >'].map(prefix => ({ text: prefix + '\n\nAfter', line: 1 })),
    { text: 'Before\n\n> 一级引用。\n>\n> > 二级引用：检查两条边线的间距和文字起点。\n\n| 项目 | 内容 | 状态 |\n| --- | --- | --- |\n| 基线 | 正文 | OK |\n\nAfter', line: 4, input: true },
    { text: '> [!NOTE]\n>\n> text\n\nAfter', line: 2 },
    { text: '\nAfter', line: 1 },
    { text: '> text\n\nAfter', line: 1 },
    { text: '>\nAfter', line: 1, mode: 'source' }
  ];
  let paintedChecks = 0;
  for (const large of [false, true]) for (const [index, fixture] of fixtures.entries()) {
    const source = fixture.text + (large ? '\n\n' + 'padding text\n'.repeat(8100) : '');
    const mode = fixture.mode ?? 'live';
    const appearance = index % 2 ? 'light' : 'dark';
    const label = `${large ? 'optimized' : 'ordinary'}/${appearance}/${mode}/${JSON.stringify(fixture.text)}`;
    const point = await page.evaluate(async ({ source, finite, number, mode, appearance, font }) => {
      const harness = (window as any).ListEditingHarness;
      harness.applyBuiltInVisualBaseline(appearance);
      document.documentElement.dataset.editorAppearance = appearance;
      const editor = harness.createEditor({ parent: document.getElementById('host')!, text: source,
        initialMode: mode, onApplyChanges() {} });
      (window as any).__quoteEditor = editor;
      editor.view.dom.style.setProperty('--meo-user-editor-font-size', font + 'px');
      editor.view.dispatch({ selection: { anchor: finite.length } }); editor.view.focus();
      for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const line = [...editor.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')].find(line =>
        editor.view.state.doc.lineAt(editor.view.posAtDOM(line)).number === number)!;
      const rect = line.getBoundingClientRect();
      const hiddenGlyphs = [...line.querySelectorAll<HTMLElement>('.meo-md-quote-marker, .meo-md-quote-marker *')].every(marker => {
        const style = getComputedStyle(marker);
        return style.visibility === 'hidden' || style.webkitTextFillColor === 'rgba(0, 0, 0, 0)';
      });
      return { x: Math.ceil(rect.left + 200), y: Math.floor((rect.top + rect.bottom) / 2), top: rect.top, bottom: rect.bottom,
        expected: editor.view.state.doc.line(number).to, optimized: harness.usesLargeDocumentDerivedWorkBudget(editor.view.state), hiddenGlyphs };
    }, { source, finite: fixture.text, number: fixture.line, mode, appearance, font: index % 3 ? 16 : 30 });
    assert.equal(point.optimized, large, label + ': actual derived-work budget');
    assert.equal(point.hiddenGlyphs, true, label + ': inactive quote glyphs remain hidden');
    const check = async (phase: string) => {
      const selection = await page.evaluate(() => {
        const view = (window as any).__quoteEditor.view, native = getSelection();
        return { head: view.state.selection.main.head, empty: view.state.selection.main.empty,
          nativeHead: native?.focusNode ? view.posAtDOM(native.focusNode, native.focusOffset) : null };
      });
      assert.equal(selection.head, point.expected, label + '/' + phase + ': document caret');
      assert.equal(selection.nativeHead, point.expected, label + '/' + phase + ': native caret');
      assert.equal(selection.empty, true, label + '/' + phase);
      const png = await page.screenshot();
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let painted = 0, outside = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset]! > 240 && data[offset + 1]! < 30 && data[offset + 2]! > 240) {
          painted++;
          if (y < point.top - 1 || y > point.bottom + 1) outside++;
        }
      }
      if (!painted || outside || process.env.MEO_TEST_SCREENSHOTS && fixture.input && !large) {
        const directory = process.env.MEO_TEST_SCREENSHOTS ?? '.local/quote-caret';
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `quote-caret-${large ? 'optimized' : 'ordinary'}-${index}-${phase}.png`), png);
      }
      assert.ok(painted >= 5 && outside === 0, label + '/' + phase + ': native caret must paint on the pressed row ' + JSON.stringify({ painted, outside, point }));
      paintedChecks++;
    };
    let pointerHeld = false;
    try {
      await page.mouse.move(point.x, point.y); await page.mouse.down(); pointerHeld = true;
      await check('pressed');
      await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
      await check('held');
      await page.mouse.up(); pointerHeld = false;
      await check('released');
      if (fixture.input) {
        const dragEnd = await page.evaluate(() => {
          const view = (window as any).__quoteEditor.view, expected = view.state.doc.line(5).to;
          const rect = view.coordsAtPos(expected)!;
          return { x: Math.ceil(rect.left + 1), y: Math.floor((rect.top + rect.bottom) / 2), expected };
        });
        await page.mouse.move(point.x, point.y); await page.mouse.down(); pointerHeld = true;
        await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 5 });
        const selection = () => page.evaluate(() => {
          const range = (window as any).__quoteEditor.view.state.selection.main;
          return { anchor: range.anchor, head: range.head, empty: range.empty };
        });
        assert.deepEqual(await selection(), { anchor: point.expected, head: dragEnd.expected, empty: false }, label + '/held drag');
        await page.mouse.up(); pointerHeld = false;
        assert.deepEqual(await selection(), { anchor: point.expected, head: dragEnd.expected, empty: false }, label + '/released drag');
        await page.mouse.click(point.x, point.y);
        await page.keyboard.type('Z');
        const inserted = source.slice(0, point.expected) + 'Z' + source.slice(point.expected);
        assert.equal(await page.evaluate(() => (window as any).__quoteEditor.getText()), inserted, label + '/input');
        for (const operation of ['undo', 'redo'] as const) {
          const result = await page.evaluate(async operation => {
            const editor = (window as any).__quoteEditor; await editor[operation]();
            return { text: editor.getText(), head: editor.view.state.selection.main.head };
          }, operation);
          assert.equal(result.text, operation === 'undo' ? source : inserted, label + '/' + operation);
          assert.equal(result.head, point.expected + (operation === 'redo' ? 1 : 0), label + '/' + operation + '/caret');
        }
      } else assert.equal(await page.evaluate(() => (window as any).__quoteEditor.getText()), source, label + '/unchanged');
    } finally {
      if (pointerHeld) await page.mouse.up();
      await page.evaluate(() => (window as any).__quoteEditor.destroy());
    }
  }
  await caretStyle.evaluate(style => style.remove());
  console.log(`quote held-pointer caret pixels passed: ${paintedChecks} pressed/held/released checks, ordinary/optimized, nesting, lists, alerts, Source, input and history`);
}

async function main(): Promise<void> {
  const build = await Bun.build({
    entrypoints: [path.join(root, 'scripts', 'test-list-editing-entry.ts')],
    outdir: tempDir,
    target: 'browser',
    format: 'iife',
    naming: 'bundle.js'
  });
  if (!build.success) throw new Error(build.logs.map(String).join('\n'));

  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><style>html,body{margin:0}#host{width:680px;height:400px}</style><div id="host"></div>');
    await page.addStyleTag({ path: path.join(root, 'webview', 'src', 'styles.css') });
    await page.addStyleTag({ content: ':root{--meo-background:#fff;--meo-foreground:#24292f;--meo-font-live:Arial;--meo-font-live-size:16px;--meo-semantic-blockquoteBorder:#888;--meo-semantic-blockquoteForeground:#555;--vscode-editor-font-family:monospace;--vscode-editor-font-size:14px}' });
    await page.addScriptTag({ path: path.join(tempDir, 'bundle.js') });
    await assertHeldQuoteCarets(page);
    if (process.argv.includes('--held-only')) return;
    const settle = () => page.evaluate(async () => {
      for (let frame = 0; frame < 6; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });
    const contentLeft = () => page.evaluate(() => {
      const line = document.querySelectorAll<HTMLElement>('#host .cm-line')[2]!;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const offset = node.textContent!.indexOf('文');
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        return range.getBoundingClientRect().left;
      }
      throw new Error('Quoted content is missing');
    });

    for (const quote of ['> 文字', '> > 文字', '>>文字', '>>>文字', '>   >  文字', '  >\t>\t文字',
      '> # 文字', '> > ## 文字', '> - 文字', '> > - 文字', '- > 文字', '> - > 文字',
      '> - [ ] 文字', '> > - [x] 文字', '> 1. 文字', '> **文字**', '> `文字`', '> [文字](https://example.com)']) {
      await page.evaluate((quote) => {
        const editor = (window as any).ListEditingHarness.createEditor({
          parent: document.getElementById('host')!,
          text: `Before\n\n${quote}\n\nAfter`, initialMode: 'live', onApplyChanges() {}
        });
        (window as any).__quoteEditor = editor;
        editor.focus();
      }, quote);
      await settle();
      try {
        const contentOffset = quote.indexOf('文');
        const inactiveContentLeft = await contentLeft();
        const railPoint = await page.evaluate(() => {
          const line = document.querySelectorAll<HTMLElement>('#host .cm-line')[2]!;
          const rect = line.getBoundingClientRect();
          return { x: rect.left + Number.parseFloat(getComputedStyle(line, '::before').left) + 1,
            y: (rect.top + rect.bottom) / 2 };
        });
        await page.mouse.click(railPoint.x, railPoint.y);
        await settle();
        const railOffset = await page.evaluate(() => {
          const view = (window as any).__quoteEditor.view;
          return view.state.selection.main.head - view.state.doc.line(3).from;
        });
        assert.equal(railOffset, contentOffset, `${JSON.stringify(quote)}: inactive quote rail must enter the content start`);
        if (/^[ \t>]+文字$/.test(quote)) {
          assert.ok(Math.abs(await contentLeft() - inactiveContentLeft) <= 1,
            `${JSON.stringify(quote)}: revealing quote prefixes must not move the rendered body`);
        }
        for (const active of [false, true]) {
          for (const side of ['left', 'right'] as const) {
            await page.evaluate(({ active, contentOffset }) => {
              const view = (window as any).__quoteEditor.view;
              view.dispatch({ selection: { anchor: active ? view.state.doc.line(3).from + contentOffset : 0 } });
              view.focus();
            }, { active, contentOffset });
            await settle();
            const point = await page.evaluate((side) => {
              const line = document.querySelectorAll<HTMLElement>('#host .cm-line')[2]!;
              const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const offset = node.textContent!.indexOf('文');
                if (offset < 0) continue;
                const range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + 1);
                const rect = range.getBoundingClientRect();
                return { x: rect.left + rect.width * (side === 'left' ? 0.2 : 0.8), y: (rect.top + rect.bottom) / 2 };
              }
              throw new Error('Quoted content is missing');
            }, side);
            await page.mouse.click(point.x, point.y);
            await settle();
            const offset = await page.evaluate(() => {
              const view = (window as any).__quoteEditor.view;
              return view.state.selection.main.head - view.state.doc.line(3).from;
            });
            assert.equal(offset, contentOffset + (side === 'right' ? 1 : 0),
              `${JSON.stringify(quote)}: ${active ? 'active' : 'inactive'} first-character ${side} click`);
          }
        }

        const quoteOffsets = [...quote.matchAll(/>/g)].map((match) => match.index!);
        for (const [index, markerOffset] of quoteOffsets.entries()) {
          for (const side of ['left', 'right'] as const) {
            const point = await page.evaluate(({ index, side }) => {
              const marker = document.querySelectorAll<HTMLElement>('#host .meo-md-quote-marker-active')[index]!;
              const range = document.createRange();
              range.selectNodeContents(marker);
              const rect = range.getBoundingClientRect();
              return { x: rect.left + rect.width * (side === 'left' ? 0.2 : 0.8), y: (rect.top + rect.bottom) / 2 };
            }, { index, side });
            await page.mouse.click(point.x, point.y);
            await settle();
            const offset = await page.evaluate(() => {
              const view = (window as any).__quoteEditor.view;
              return view.state.selection.main.head - view.state.doc.line(3).from;
            });
            assert.equal(offset, markerOffset + (side === 'right' ? 1 : 0),
              `${JSON.stringify(quote)}: quote marker ${index + 1} ${side} click must preserve its source boundary`);
          }
        }

        // Check geometry independently of posAtCoords: distinct source stops
        // must remain ordered even when the quote marks have no separating spaces.
        const prefix = /^[ \t>]+/.exec(quote)?.[0] ?? '';
        if (prefix && !quote.slice(prefix.length).startsWith('-')) {
          const positions = await page.evaluate((prefixLength) => {
            const view = (window as any).__quoteEditor.view;
            const line = view.state.doc.line(3);
            return Array.from({ length: prefixLength + 1 }, (_, offset) => ({
              offset, x: view.coordsAtPos(line.from + offset)?.left ?? null
            }));
          }, prefix.length);
          for (let index = 0; index < positions.length; index += 1) {
            assert.notEqual(positions[index]!.x, null, `${JSON.stringify(quote)}: source stop ${index} has no coordinates`);
            if (index > 0) {
              assert.ok(positions[index]!.x! > positions[index - 1]!.x! + 0.5,
                `${JSON.stringify(quote)}: prefix caret coordinates overlap or reverse: ${JSON.stringify(positions)}`);
            }
          }
          await page.evaluate((contentOffset) => {
            const view = (window as any).__quoteEditor.view;
            view.dispatch({ selection: { anchor: view.state.doc.line(3).from + contentOffset } });
            view.focus();
          }, contentOffset);
          await settle();
          for (let expected = contentOffset - 1; expected >= 0; expected -= 1) {
            await page.keyboard.press('ArrowLeft');
            await settle();
            const offset = await page.evaluate(() => {
              const view = (window as any).__quoteEditor.view;
              return view.state.selection.main.head - view.state.doc.line(3).from;
            });
            assert.equal(offset, expected, `${JSON.stringify(quote)}: ArrowLeft must reach each prefix character`);
          }
        }
        assert.equal(await page.evaluate(() => (window as any).__quoteEditor.getText()), `Before\n\n${quote}\n\nAfter`);
      } finally {
        await page.evaluate(() => (window as any).__quoteEditor.destroy());
      }
    }

    for (const quote of ['> text', '> ', '>', '> > ', '>>', '> > > ', '>>>', '> > > > ', '>   >  ', '  >\t>\t']) {
      await page.evaluate((quote) => {
        const editor = (window as any).ListEditingHarness.createEditor({
          parent: document.getElementById('host')!,
          text: `Before\n\n${quote}\n\nAfter`, initialMode: 'live', onApplyChanges() {}
        });
        (window as any).__quoteEditor = editor;
        editor.focus();
      }, quote);
      await settle();
      try {
        for (let click = 0; click < 2; click += 1) {
          const point = await page.evaluate(() => {
            const line = document.querySelectorAll<HTMLElement>('#host .cm-line')[2]!;
            const rect = line.getBoundingClientRect();
            return { x: rect.left + 200, y: (rect.top + rect.bottom) / 2 };
          });
          await page.mouse.click(point.x, point.y);
          await settle();
          const result = await page.evaluate(() => {
            const editor = (window as any).__quoteEditor;
            const line = editor.view.state.doc.line(3);
            return { head: editor.view.state.selection.main.head, expected: line.to };
          });
          assert.equal(result.head, result.expected, `click ${click + 1} in ${JSON.stringify(quote)} must reach the quoted content start`);
        }
        const markerClick = await page.evaluate(() => {
          const editor = (window as any).__quoteEditor;
          const marker = document.querySelector<HTMLElement>('#host .meo-md-quote-marker-active')!;
          const rect = marker.getBoundingClientRect();
          const x = rect.left + 1;
          const y = (rect.top + rect.bottom) / 2;
          return { x, y, expected: editor.view.posAtCoords({ x, y }) };
        });
        await page.mouse.click(markerClick.x, markerClick.y);
        await settle();
        const markerHead = await page.evaluate(() => (window as any).__quoteEditor.view.state.selection.main.head);
        assert.equal(markerHead, markerClick.expected, `clicking a visible marker in ${JSON.stringify(quote)} must preserve the clicked position`);
        await page.mouse.move(markerClick.x, markerClick.y);
        await page.mouse.down();
        const dragEnd = await page.evaluate(() => {
          const line = document.querySelectorAll<HTMLElement>('#host .cm-line')[4]!;
          const rect = line.getBoundingClientRect();
          return { x: rect.left + 200, y: (rect.top + rect.bottom) / 2 };
        });
        await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 5 });
        const dragged = await page.evaluate(() => {
          const selection = (window as any).__quoteEditor.view.state.selection.main;
          return { anchor: selection.anchor, head: selection.head, empty: selection.empty };
        });
        await page.mouse.up();
        await settle();
        const released = await page.evaluate(() => {
          const selection = (window as any).__quoteEditor.view.state.selection.main;
          return { anchor: selection.anchor, head: selection.head, empty: selection.empty };
        });
        assert.equal(dragged.empty, false, `dragging from ${JSON.stringify(quote)} to the next paragraph must select text`);
        assert.deepEqual(released, dragged, 'releasing a drag must preserve its selection');
        await page.evaluate(() => {
          const editor = (window as any).__quoteEditor;
          editor.view.dispatch({ selection: { anchor: editor.view.state.doc.line(1).to } });
        });
        await page.keyboard.down('Shift');
        await page.mouse.click(markerClick.x + 200, markerClick.y);
        await page.keyboard.up('Shift');
        await settle();
        const extended = await page.evaluate(() => {
          const editor = (window as any).__quoteEditor;
          return { anchor: editor.view.state.selection.main.anchor, empty: editor.view.state.selection.main.empty,
            expected: editor.view.state.doc.line(1).to };
        });
        assert.equal(extended.anchor, extended.expected, 'Shift-click must preserve the original anchor');
        assert.equal(extended.empty, false, 'Shift-click must extend the selection');
        await page.evaluate(() => (window as any).__quoteEditor.setMode('source'));
        await settle();
        const sourceClick = await page.evaluate(() => {
          const editor = (window as any).__quoteEditor;
          const coords = editor.view.coordsAtPos(editor.view.state.doc.line(3).from)!;
          return { x: coords.left + 1, y: (coords.top + coords.bottom) / 2,
            expected: editor.view.posAtCoords({ x: coords.left + 1, y: (coords.top + coords.bottom) / 2 }) };
        });
        await page.mouse.click(sourceClick.x, sourceClick.y);
        await settle();
        const sourceHead = await page.evaluate(() => (window as any).__quoteEditor.view.state.selection.main.head);
        assert.equal(sourceHead, sourceClick.expected, 'Source mode must retain ordinary coordinate placement');
        assert.equal(await page.evaluate(() => (window as any).__quoteEditor.getText()), `Before\n\n${quote}\n\nAfter`, 'pointer interactions must not alter the quote');
      } finally {
        await page.evaluate(() => (window as any).__quoteEditor.destroy());
      }
    }
    console.log('quote caret Chromium checks passed: first-character clicks, prefix geometry, keyboard stops, nesting, whitespace, repeated clicks, markers, dragging, Shift-click and Source mode');
  } finally {
    await closeTestBrowser(browser);
  }
}

await main()
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
