import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchTestBrowser } from './browser-test-helpers';

const repoRoot = path.resolve(import.meta.dir, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-rendered-mode-shell-'));

const rendererProbeModule = String.raw`
type Probe =
  | { kind: 'normal' }
  | { kind: 'error' };

let probe: Probe = { kind: 'normal' };

export function setMathRendererProbe(next: Probe): void {
  probe = next;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderMathToHtml(content: string): string | null {
  if (probe.kind === 'error') {
    return null;
  }
  return '<span class="katex" data-rendered-math>' + escapeHtml(content) + '</span>';
}
`;

async function main(): Promise<void> {
  const build = await Bun.build({
    entrypoints: [path.join(repoRoot, 'scripts', 'test-rendered-block-mode-shell-production-entry.ts')],
    outdir: tempDir,
    target: 'browser',
    format: 'iife',
    naming: 'bundle.js',
    plugins: [{
      name: 'controlled-math-renderer',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]src[\\/]shared[\\/]mathRenderer\.ts$/ }, () => ({
          contents: rendererProbeModule,
          loader: 'ts'
        }));
      }
    }]
  });
  if (!build.success) throw new Error(build.logs.map(String).join('\n'));

  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 1 });
    await page.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div>');
    await page.addStyleTag({ path: path.join(repoRoot, 'webview', 'src', 'styles.css') });
    await page.addStyleTag({
      content: ':root{--meo-background:#fff;--meo-foreground:#24292f;--meo-code-background:#f6f8fa;--meo-surface-background:#fff;--meo-color-base05:#0969da;--meo-font-live:Arial;--meo-font-live-weight:400;--meo-font-live-size:16px;--meo-font-source:monospace;--meo-font-source-weight:500;--meo-font-source-size:14px;--meo-semantic-mutedForeground:#57606a;--meo-semantic-codeCopyForeground:#0969da;--meo-semantic-codeCopyBackground:transparent;--meo-semantic-codeCopyHoverForeground:#0969da;--meo-semantic-codeCopyHoverBackground:#eaeef2;--vscode-editor-font-family:monospace;--vscode-editor-font-size:14px;--vscode-editor-line-height:20px}'
    });
    await page.addScriptTag({ path: path.join(tempDir, 'bundle.js') });
    await page.evaluate(() => {
      const harness = (window as any).RenderedBlockModeShellProductionHarness;
      (window as any).__renderedModeEditor = harness.createEditor({
        parent: document.getElementById('app')!,
        text: 'before\n\n$$\nx = 1\n$$\n\nafter',
        initialMode: 'live',
        onApplyChanges() {}
      });
    });
    await page.waitForSelector('.meo-md-math-fenced-display');
    await page.click('.meo-md-math-fenced-display [data-rendered-math]');
    await page.waitForSelector('.meo-math-live-result');
    await page.keyboard.press('End');
    await page.keyboard.press('S');
    await page.waitForFunction(() => document.querySelector('.meo-math-live-result')?.textContent?.includes('x = 1S'));
    const renderedImmediately = await page.evaluate(() =>
      document.querySelector('.meo-math-live-result [data-rendered-math]')
        ?.textContent?.includes('x = 1S') === true
    );
    assert.equal(renderedImmediately, true,
      'Split mode must expose the synchronous renderer result after the keyboard input returns');
    const beforeErrorEdit = await page.evaluate(() => {
      const outerScroller = document.querySelector<HTMLElement>('#app > .cm-editor > .cm-scroller')!;
      return { scrollTop: outerScroller.scrollTop };
    });
    await page.evaluate(() => {
      (window as any).RenderedBlockModeShellProductionHarness.setMathRendererProbe({ kind: 'error' });
    });
    const afterErrorEdit = await page.evaluate(() => {
      // Native contenteditable input commits through CodeMirror's DOM observer.
      // Check synchronous presentation at the document transaction boundary,
      // without waiting for the error label or a rendering frame.
      const view = (window as any).__renderedModeEditor.view;
      const from = view.state.selection.main.head;
      view.dispatch({ changes: { from, insert: 'E' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
      const source = document.querySelector<HTMLElement>(
        '#app > .cm-editor .cm-content'
      )!;
      const error = document.querySelector<HTMLElement>(
        '.meo-math-result-status'
      );
      const selection = window.getSelection();
      const outerScroller = document.querySelector<HTMLElement>('#app > .cm-editor > .cm-scroller')!;
      return {
        errorText: error?.textContent ?? null,
        sourceFocused: source.contains(document.activeElement),
        caretInSource: Boolean(selection?.isCollapsed && selection.anchorNode && source.contains(selection.anchorNode)),
        scrollTop: outerScroller.scrollTop
      };
    });
    assert.equal(afterErrorEdit.sourceFocused, true, 'Synchronous renderer errors must preserve source focus');
    assert.equal(afterErrorEdit.caretInSource, true, 'Synchronous renderer errors must preserve the public DOM caret');
    assert.ok(Math.abs(afterErrorEdit.scrollTop - beforeErrorEdit.scrollTop) <= 1,
      'Synchronous renderer errors must not move the outer viewport');
    await page.waitForFunction(() => document.querySelector('.meo-math-result-status[role="status"]')?.textContent?.includes('last valid result'));
    for (let frame = 0; frame < 2; frame++) {
      const settled = await page.evaluate(() => {
        const view = (window as any).__renderedModeEditor.view;
        const selection = window.getSelection();
        return {
          text: view.state.doc.toString(), focused: view.hasFocus && document.activeElement === view.contentDOM,
          caret: !!selection?.isCollapsed && !!selection.anchorNode && view.contentDOM.contains(selection.anchorNode),
          result: document.querySelector('.meo-math-live-result [data-rendered-math]')?.textContent,
          scroll: view.scrollDOM.scrollTop
        };
      });
      assert.equal(settled.text.includes('x = 1SE'), true);
      assert.equal(settled.result, 'x = 1S', 'The derived error presentation must retain the last valid result');
      assert.equal(settled.focused && settled.caret, true);
      assert.ok(Math.abs(settled.scroll - beforeErrorEdit.scrollTop) <= 1);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    assert.deepEqual(pageErrors, [], 'Split mode must expose source text before rendering');
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('Rendered block mode shell production tests passed');
}

await main();
