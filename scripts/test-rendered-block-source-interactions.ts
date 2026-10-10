import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

type Kind = 'mermaid' | 'latex-math';
const caseFilter = process.argv.find(argument => argument.startsWith('--case='))?.slice('--case='.length);
const build = await Bun.build({
  entrypoints: ['scripts/test-mermaid-editing-entry.ts'], target: 'browser', format: 'iife'
});
if (!build.success) throw new Error(build.logs.map(String).join('\n'));

const frames = (page: Page, count = 8) => page.evaluate(async count => {
  for (let i = 0; i < count; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}, count);
const browser = await launchTestBrowser();
let primaryError: unknown;
try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  const failures: string[] = [];
  let checks = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setContent('<!doctype html><meta charset="UTF-8"><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
  await page.addStyleTag({ path: 'webview/src/styles.css' });
  // Embed fonts so geometry checks do not depend on network or fallback metrics.
  const katexDirectory = 'node_modules/katex/dist';
  const katexCss = fs.readFileSync(path.join(katexDirectory, 'katex.min.css'), 'utf8')
    .replace(/url\((fonts\/[^)]+)\)/g, (_match, file) => {
      const extension = path.extname(file).slice(1);
      return `url(data:font/${extension};base64,${fs.readFileSync(path.join(katexDirectory, file)).toString('base64')})`;
    });
  await page.addStyleTag({ content: katexCss });
  await page.addStyleTag({ content: ':root{--meo-font-live:Arial;--meo-font-live-size:18px;--meo-font-source:monospace;--meo-font-source-size:18px;--meo-semantic-codeCopyBackground:transparent;--meo-semantic-codeCopyHoverBackground:rgba(127,127,127,.2)}' });
  await page.addScriptTag({ content: fs.readFileSync('webview/dist/mermaid.min.js', 'utf8') });
  await page.addScriptTag({ content: await build.outputs[0]!.text() });
  const check = (label: string, action: () => void) => {
    checks++;
    try { action(); } catch (error) {
      const message = `${label}: ${(error as Error).message}`;
      failures.push(message);
      console.error(message);
    }
  };

  await page.evaluate(() => {
    const host = window as any;
    host.controller = () => {
      const block = document.querySelector(`.meo-${host.kind}-editing-block`) as any;
      return block?.[host.kind === 'mermaid' ? '__meoMermaidEditingController' : '__meoLatexMathEditingController'];
    };
    host.readSource = () => {
      const editor = host.sourceEditor;
      const controller = host.controller();
      const view = controller?.innerView;
      const selection = view?.state.selection.main;
      const caret = selection && view.coordsAtPos(selection.head);
      const rows = controller ? Array.from<HTMLElement>(controller.root.querySelectorAll('.cm-content > .cm-line')) : [];
      const local = controller ? Array.from<HTMLElement>(controller.root.querySelectorAll('.cm-lineNumbers > .cm-gutterElement'))
        .filter(el => getComputedStyle(el).visibility !== 'hidden' && /^\d+$/.test(el.textContent?.trim() ?? '')) : [];
      const firstLine = controller && editor.view.state.doc.lineAt(controller.block.contentFrom).number;
      const labels = Array.from<HTMLElement>(editor.view.dom.querySelectorAll('.meo-rendered-block-document-line-number'));
      return {
        source: view?.state.doc.toString() ?? null, head: selection?.head ?? null, anchor: selection?.anchor ?? null,
        focused: view?.hasFocus ?? false, outerFocused: editor.view.hasFocus,
        outerLine: editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number,
        caretLeft: caret?.left ?? null, caretTop: caret?.top ?? null, scroll: editor.view.scrollDOM.scrollTop,
        offsets: local.map((marker, index) => {
          const number = Number(marker.textContent!.trim());
          const label = labels.find(el => el.textContent?.trim() === String(firstLine + number - 1));
          const row = rows.length === local.length ? rows[index] : marker;
          return label ? label.getBoundingClientRect().top - row.getBoundingClientRect().top : null;
        })
      };
    };
    host.trace = () => {
      host.samples = [];
      let count = 0;
      const sample = () => { host.samples.push(host.readSource()); if (++count < 8) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    };
    host.armInputTrace = () => {
      // Start after the actual input event. Sampling before CDP delivers the key
      // mistakes the intended caret movement for a later layout correction.
      document.addEventListener('keydown', () => host.trace(), { once: true });
    };
  });
  const read = () => page.evaluate(() => (window as any).readSource());
  const focus = (edge: 'start' | 'end') => page.evaluate(edge => {
    const controller = (window as any).controller();
    const view = controller.innerView;
    view.dispatch({ selection: { anchor: edge === 'start' ? 0 : view.state.doc.length } });
    view.contentDOM.focus({ preventScroll: true });
  }, edge);
  const cycle = async (kind: Kind, label: string) => {
    await page.evaluate(kind => {
      (window as any).trace();
      document.querySelector<HTMLButtonElement>(`.meo-${kind}-mode-btn`)!.click();
    }, kind);
    await frames(page, 10);
    const samples: any[] = await page.evaluate(() => (window as any).samples);
    check(`${label} frame line numbers`, () => assert.ok(samples.every(sample => sample.offsets.every((offset: number | null) => offset !== null && Math.abs(offset) <= 1)), JSON.stringify(samples)));
  };

  // Display math now edits in the document; test-display-math-editing covers that path.
  for (const kind of ['mermaid'] as const) {
    if (process.argv.includes('--extended-only')) continue;
    for (const container of ['plain', 'list', 'nested-list', 'quote', 'quote-list', 'footnote'] as const) {
      for (const narrow of [false, true]) {
        const label = `${kind}/${container}/${narrow ? 'narrow-light' : 'wide-dark'}`;
        if (caseFilter && label !== caseFilter) continue;
        console.log(`Checking ${label}`);
        const prefix = container === 'list' ? '  ' : container === 'nested-list' ? '    ' : container === 'quote' ? '> ' : container === 'quote-list' ? '>   ' : container === 'footnote' ? '    ' : '';
        const parent = container === 'list' ? '- Parent' : container === 'nested-list' ? '- Parent\n  - Child' : container === 'quote' ? '> Parent' : container === 'quote-list' ? '> - Parent' : container === 'footnote' ? '[^test]: Parent' : 'Parent';
        const payload = kind === 'mermaid' ? ['flowchart LR', '  A[起点] --> B[终点]'] : ['x = 1', '  + y'];
        const fence = kind === 'mermaid' ? ['```mermaid', '```'] : ['$$', '$$'];
        const text = ['before', '', parent, '', prefix + fence[0], ...payload.map(line => prefix + line), prefix + fence[1], '', 'after', '', 'reference[^test]'].join('\n');
        await page.setViewport({ width: narrow ? 520 : 1100, height: 900 });
        await page.evaluate(({ kind, text, narrow }) => {
          const host = window as any;
          host.sourceEditor?.destroy();
          document.querySelector('#app')!.replaceChildren();
          host.kind = kind;
          document.documentElement.dataset.editorAppearance = narrow ? 'light' : 'dark';
          for (const [name, value] of Object.entries({
            '--meo-background': narrow ? '#fafafa' : '#24292e', '--meo-foreground': narrow ? '#24292e' : '#e6edf3',
            '--meo-code-background': narrow ? '#f0f1f3' : '#1b2024', '--meo-semantic-mutedForeground': narrow ? '#586069' : '#8b949e'
          })) document.documentElement.style.setProperty(name, value);
          host.MermaidEditingHarness.refreshMermaidTheme();
          host.sourceEditor = host.MermaidEditingHarness.createEditor({ parent: document.querySelector('#app'), text, initialMode: 'live', onApplyChanges() {} });
        }, { kind, text, narrow });
        await frames(page);
        await page.waitForSelector(`.meo-${kind}-mode-btn`);
        for (const mode of ['split', 'source'] as const) {
          await cycle(kind, `${label}/${mode}`);
          await focus('end');
          const initial = await read();
          const originalText = await page.evaluate(() => (window as any).sourceEditor.getText());
          for (const key of ['Enter', 'Tab', 'Backspace', 'Shift+Tab', 'ArrowLeft', 'ArrowRight', 'X', 'Backspace']) {
            if (key === 'Shift+Tab') await page.keyboard.down('Shift');
            await page.evaluate(() => (window as any).armInputTrace());
            await page.keyboard.press(key === 'Shift+Tab' ? 'Tab' : key as any);
            if (key === 'Shift+Tab') await page.keyboard.up('Shift');
            await frames(page, 10);
            const samples: any[] = await page.evaluate(() => (window as any).samples);
            check(`${label}/${mode}/${key} caret and source`, () => {
              assert.ok(samples.length > 1);
              assert.ok(samples.every(sample => sample.focused), 'inner focus lost');
              assert.equal(new Set(samples.map(sample => sample.source)).size, 1, 'source changes after the input event');
              assert.equal(new Set(samples.map(sample => sample.head)).size, 1, 'caret offset changes after the input event');
              const left = samples.map(sample => sample.caretLeft), top = samples.map(sample => sample.caretTop);
              assert.ok(Math.max(...left) - Math.min(...left) <= 1, 'caret moves horizontally after input');
              assert.ok(Math.max(...top) - Math.min(...top) <= 1, 'caret moves vertically after input');
              assert.ok(samples.every(sample => sample.offsets.every((offset: number | null) => offset !== null && Math.abs(offset) <= 1)), 'document line numbers drift');
            });
            if (key === 'Enter') {
              const expectedIndent = initial.source.split('\n').at(-1).match(/^\s*/)[0];
              check(`${label}/${mode} new empty line`, () => assert.equal(samples.at(-1).source, `${initial.source}\n${expectedIndent}`));
            }
          }
          const editedText = await page.evaluate(() => (window as any).sourceEditor.getText());
          await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
          await frames(page, 12);
          await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
          await frames(page, 12);
          // Read after keyboard replay, rather than checking a local inner history.
          const replayText = await page.evaluate(() => (window as any).sourceEditor.getText());
          check(`${label}/${mode} history round trip`, () => assert.equal(replayText, editedText));
          if (!(await read()).source) throw new Error(`${label}/${mode}: history removed the internal source editor`);

          // Cancel any pending restoration before testing explicit navigation.
          await page.evaluate(() => {
            const host = window as any;
            host.controller().cancelModeSelectionRestore?.();
          });
          const boundaryLines = await page.evaluate(() => {
            const host = window as any, block = host.controller().block;
            return { opening: host.sourceEditor.view.state.doc.lineAt(block.anchor).number,
              closing: host.sourceEditor.view.state.doc.lineAt(block.contentTo).number + 1 };
          });
          for (const [edge, key] of [['start', 'ArrowUp'], ['start', 'ArrowLeft'], ['end', 'ArrowDown'], ['end', 'ArrowRight']] as const) {
            await focus(edge);
            await page.keyboard.press(key);
            await frames(page);
            const state = await read();
            check(`${label}/${mode}/${key} leaves source`, () => {
              assert.ok(state.outerFocused && !state.focused, JSON.stringify(state));
              // Crossing returns to the fence, preserving the Markdown boundary.
              assert.equal(state.outerLine, edge === 'start' ? boundaryLines.opening : boundaryLines.closing);
            });
          }
          for (const [line, key] of [[boundaryLines.opening, 'ArrowDown'], [boundaryLines.closing, 'ArrowUp'], [boundaryLines.opening, 'ArrowRight'], [boundaryLines.closing, 'ArrowLeft']] as const) {
            await page.evaluate(({ line, key }) => {
              const view = (window as any).sourceEditor.view;
              const target = view.state.doc.line(line);
              view.dispatch({ selection: { anchor: key === 'ArrowRight' ? target.to : target.from } });
              view.contentDOM.focus({ preventScroll: true });
            }, { line, key });
            await page.keyboard.press(key);
            await frames(page);
            const entered = await read();
            check(`${label}/${mode}/${key} enters source`, () => assert.ok(entered.focused && !entered.outerFocused, JSON.stringify(entered)));
          }
          const boundaryText = await page.evaluate(() => (window as any).sourceEditor.getText());
          for (const [edge, key] of [['start', 'Backspace'], ['end', 'Delete']] as const) {
            await focus(edge); await page.keyboard.press(key); await frames(page);
            const actual = await page.evaluate(() => (window as any).sourceEditor.getText());
            check(`${label}/${mode}/${key} protects fences`, () => assert.equal(actual, boundaryText));
          }
          for (const [edge, key] of [['start', 'ArrowUp'], ['end', 'ArrowDown']] as const) {
            await focus(edge);
            const mapped = await page.evaluate(() => (window as any).controller().getModeSelection());
            await page.keyboard.down('Shift'); await page.keyboard.press(key); await page.keyboard.up('Shift');
            await frames(page);
            const selection = await page.evaluate(() => {
              const view = (window as any).sourceEditor.view;
              return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head, focused: view.hasFocus };
            });
            check(`${label}/${mode}/Shift+${key} cross-boundary selection`, () => {
              assert.ok(selection.focused && selection.head !== selection.anchor);
              assert.equal(selection.anchor, mapped.anchor);
            });
          }
          check(`${label}/${mode} fences retained`, () => {
            assert.ok(replayText.includes(prefix + fence[0]));
            assert.ok(replayText.includes(prefix + fence[1]));
            assert.ok(replayText.startsWith('before\n') && replayText.endsWith('reference[^test]'));
          });
          // Mouse can leave and re-enter without being stolen by deferred focus.
          const point = await page.evaluate(() => {
            const host = window as any, view = host.sourceEditor.view;
            const rect = view.coordsAtPos(view.state.doc.line(1).from)!;
            return { x: rect.left + 5, y: (rect.top + rect.bottom) / 2 };
          });
          await page.mouse.click(point.x, point.y);
          await frames(page, 12);
          const outside = await read();
          check(`${label}/${mode} click outside`, () => assert.ok(outside.outerFocused && !outside.focused));
          const sourcePoint = await page.evaluate(() => {
            const view = (window as any).controller().innerView, rect = view.coordsAtPos(1)!;
            return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
          });
          await page.mouse.click(sourcePoint.x, sourcePoint.y);
          await frames(page, 12);
          const inside = await read();
          check(`${label}/${mode} click inside`, () => assert.ok(inside.focused && !inside.outerFocused));
          // Reset source contents without changing the manual presentation.
          await page.evaluate(source => {
            const view = (window as any).controller().innerView;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
          }, initial.source);
          await frames(page);
          const restoredText = await page.evaluate(() => (window as any).sourceEditor.getText());
          check(`${label}/${mode} source round trip`, () => assert.equal(restoredText, originalText));
        }
        await cycle(kind, `${label}/preview`);
        const finalText = await page.evaluate(() => (window as any).sourceEditor.getText());
        check(`${label} preview round trip`, () => assert.equal(finalText, text));
      }
    }
  }

  for (const kind of ['mermaid'] as const) {
    if (caseFilter) continue;
    for (const container of ['plain', 'quote', 'footnote'] as const) {
      const source = kind === 'mermaid' ? 'flowchart LR\n  A --> B' : 'x = 1\n  + y';
      const fence = kind === 'mermaid' ? ['```mermaid', '```'] : ['$$', '$$'];
      const prefix = container === 'quote' ? '> ' : container === 'footnote' ? '    ' : '';
      const parent = container === 'quote' ? '> Parent' : container === 'footnote' ? '[^test]: Parent' : 'Parent';
      const text = ['before', '', parent, '', prefix + fence[0], ...source.split('\n').map(line => prefix + line), prefix + fence[1], '', 'after[^test]'].join('\n');
      console.log(`Checking ${kind}/${container}/clipboard-composition-empty`);
      await page.setViewport({ width: 1100, height: 900 });
      await page.evaluate(({ kind, text }) => {
        const host = window as any;
        host.sourceEditor?.destroy();
        document.querySelector('#app')!.replaceChildren();
        host.kind = kind;
        host.sourceEditor = host.MermaidEditingHarness.createEditor({ parent: document.querySelector('#app'), text, initialMode: 'live', onApplyChanges() {} });
      }, { kind, text });
      await frames(page);
      await cycle(kind, `${kind}/clipboard/split`);
      await focus('end');
      await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
      const selected = await read();
      check(`${kind} Ctrl+A owns the inner document`, () => {
        assert.equal(selected.anchor, 0); assert.equal(selected.head, source.length); assert.equal(selected.source, source);
      });
      const copied = await page.evaluate(() => {
        const data = new DataTransfer();
        (window as any).controller().innerView.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData('text/plain');
      });
      check(`${kind} copies selected source`, () => assert.equal(copied, source));
      const paste = async (value: string) => {
        await page.evaluate(value => {
          const view = (window as any).controller().innerView;
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
          view.contentDOM.focus({ preventScroll: true });
          const data = new DataTransfer(); data.setData('text/plain', value);
          view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, value);
        await frames(page, 12);
      };
      const pasted = kind === 'mermaid' ? 'flowchart LR\n  A[中文] --> B[结果]\n\n  B --> C' : 'x = 1\n\n  + y + z';
      await paste(pasted);
      const pastedState = await read();
      const outerPasted = await page.evaluate(() => (window as any).sourceEditor.getText());
      check(`${kind} multiline paste preserves the container`, () => {
        assert.equal(pastedState.source, pasted);
        assert.ok(pastedState.focused);
        assert.ok(outerPasted.includes(pasted.split('\n').map(line => prefix + line).join('\n')));
      });
      // CDP drives real composition events through CodeMirror, without changing
      // the user's OS input method or clipboard.
      await focus('end');
      const client = await page.createCDPSession();
      await client.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
      await frames(page, 4);
      await client.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
      await frames(page, 4);
      await client.send('Input.insertText', { text: '中文' });
      await frames(page, 16);
      await client.detach();
      const composed = await read();
      check(`${kind} composition commits once and keeps focus`, () => {
        assert.equal(composed.source, pasted + '中文'); assert.ok(composed.focused);
      });
      await paste(kind === 'mermaid' ? 'flowchart LR\n  A[unfinished' : '\\frac{');
      await frames(page, 30);
      const invalid = await read();
      check(`${kind} invalid source remains editable`, () => assert.ok(invalid.source !== null && invalid.focused));
      await paste(source);
      await frames(page, 20);
      await page.waitForSelector(`.meo-${kind}-editing-block ${kind === 'mermaid' ? 'svg' : '.katex'}`);
      const recovered = await page.$(`.meo-${kind}-editing-block ${kind === 'mermaid' ? 'svg' : '.katex'}`);
      check(`${kind} valid preview recovers after an error`, () => assert.ok(recovered));
      await paste('');
      await frames(page, 40);
      const empty = await read();
      check(`${kind} empty source remains editable`, () => assert.ok(empty.source === '' && empty.focused, JSON.stringify(empty)));
      const emptyEditors = await page.$$(`.meo-${kind}-editing-block`);
      check(`${kind}/${container} empty source has one editor`, () => assert.equal(emptyEditors.length, 1));
      if (empty.source !== null) {
        await cycle(kind, `${kind}/${container}/empty/source`);
        const switchedEmpty = await read();
        check(`${kind}/${container} empty source survives mode change`, () => assert.equal(switchedEmpty.source, ''));
        await paste(source);
        const restored = await read();
        check(`${kind} empty source can be filled again`, () => assert.equal(restored.source, source));
      }
    }
  }
  check('No browser exceptions', () => assert.deepEqual(pageErrors, []));
  console.log(`Rendered block source interactions: ${checks - failures.length}/${checks} checks passed`);
  assert.deepEqual(failures, [], failures.join('\n'));
} catch (error) { primaryError = error; }
if (primaryError === undefined) await closeTestBrowser(browser); else await closeTestBrowser(browser, primaryError);
