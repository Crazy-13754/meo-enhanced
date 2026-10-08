import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { launchTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';
import { inlineSyntaxBoundaryFixtures } from './inline-syntax-boundary-fixtures';

const repoRoot = path.resolve(import.meta.dir, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-inline-syntax-boundaries-'));

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
}

async function snapshot(page: Page, selector: string) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: string[][] = [];
    const targetElements: HTMLElement[] = [];
    const visibleText: string[] = [];
    const selectors = {
      emphasis: '.meo-md-em, em, i', strong: '.meo-md-strong, strong, b',
      strikethrough: '.meo-md-strike, s, del', highlight: '.meo-md-highlight, mark',
      code: '.meo-md-inline-code, code, .meo-md-code-block, .meo-md-code-line, .meo-md-codeblock',
      subscript: '.meo-md-subscript, sub', superscript: '.meo-md-superscript, sup'
    };
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement!;
      if (element.closest('button, .katex, .meo-md-code-language, .meo-md-codeblock-language')) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      if (!Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
      const text = walker.currentNode.textContent ?? '';
      if (!element.closest('.meo-md-marker, .meo-md-marker-active, .meo-md-code-marker, .meo-md-code-marker-active, .meo-md-escape-marker')) visibleText.push(text);
      if (text.includes('TARGET')) {
        targets.push(Object.entries(selectors).filter(([, css]) => element.closest(css)).map(([name]) => name).sort());
        targetElements.push(element);
      }
    }
    return {
      targets, text: visibleText.join(''),
      visibleMarkers: Array.from(root.querySelectorAll('.meo-md-marker-active, .meo-md-code-marker-active')).filter(element => element.getBoundingClientRect().width > 0).length,
      links: targetElements.map(element => element.closest('a')?.getAttribute('href') ?? element.closest('[data-meo-link-href]')?.getAttribute('data-meo-link-href')).filter(Boolean),
      mathCount: root.querySelectorAll('.meo-md-math, .meo-export-math').length
    };
  }, selector);
}

const failures: string[] = [];
async function main(): Promise<void> {
  const build = await Bun.build({ entrypoints: [path.join(repoRoot, 'scripts/test-inline-code-layout-entry.ts')], outdir: tempDir, target: 'browser', format: 'iife', naming: 'bundle.js' });
  assert.ok(build.success, build.logs.map(String).join('\n'));
  const browser = await launchTestBrowser();
  try {
    const live = await browser.newPage();
    const preview = await browser.newPage();
    await live.bringToFront();
    await live.setViewport({ width: 1250, height: 800 });
    await preview.setViewport({ width: 1250, height: 800 });
    await live.setContent('<!doctype html><style>html,body,#app{height:100%;margin:0}</style><div id="app" class="editor-host"></div>');
    await live.addStyleTag({ path: path.join(repoRoot, 'webview/src/styles.css') });
    await live.addScriptTag({ path: path.join(tempDir, 'bundle.js') });
    for (const theme of ['dark', 'light'] as const) {
      for (const fixture of inlineSyntaxBoundaryFixtures) {
        const doc = `${fixture.markdown}\n\nCaret sentinel.`;
        const rendered = exportRuntime.renderPreviewDocument({ markdownText: fixture.markdown, sourceDocumentPath: path.join(repoRoot, 'inline-boundaries.md'), uiLanguage: 'en', styleEnvironment: { previewFontFamily: '', previewShowComments: true } });
        await preview.setContent(`<!doctype html><style>${rendered.styles[theme]}</style><main class="meo-export-content">${rendered.html}</main>`);
        await live.evaluate(({ doc, theme }) => {
          const w = window as any;
          w.boundaryEditor?.destroy();
          w.InlineCodeLayoutHarness.applyBuiltInVisualBaseline(theme);
          w.boundaryEditor = w.InlineCodeLayoutHarness.createEditor({ parent: document.getElementById('app'), text: doc, initialMode: 'live', uiLanguage: 'en', onApplyChanges() {} });
          w.boundaryEditor.view.dispatch({ selection: { anchor: doc.length } });
        }, { doc, theme });
        await settle(live);
        for (const mode of ['live', 'preview', 'live-active'] as const) {
          if (mode === 'live-active') {
            await live.evaluate(anchor => {
              const view = (window as any).boundaryEditor.view;
              view.focus(); view.dispatch({ selection: { anchor } });
            }, doc.indexOf('TARGET') + 2);
            await settle(live);
          }
          const sample = await snapshot(mode === 'preview' ? preview : live, mode === 'preview' ? 'main' : '.cm-content');
          try {
            const expected = [...fixture.styles].sort();
            assert.deepEqual(sample.targets, [expected], 'target formatting');
            if (fixture.literal) {
              // Live can reveal escape slashes as source syntax; escaped tags must still stay literal.
              const text = fixture.name === 'html-escaped-pair' && mode !== 'preview' ? sample.text.replace(/\\(?=[<>])/g, '') : sample.text;
              assert.ok(text.includes(fixture.literal), `missing literal ${fixture.literal}: ${sample.text}`);
            }
            if (fixture.mathCount !== undefined) {
              if (mode === 'live-active' && fixture.mathCount > 0 && sample.mathCount === 0) {
                for (const raw of fixture.markdown.match(/\$[^$\n]+\$/g) ?? []) assert.ok(sample.text.includes(raw), `active formula source ${raw}`);
              }
              else assert.equal(sample.mathCount, fixture.mathCount, 'math count');
            }
            if (fixture.href) assert.deepEqual(sample.links, [fixture.href], 'complete target link');
            if (mode !== 'preview') {
              assert.equal(await live.evaluate(() => (window as any).boundaryEditor.view.state.doc.toString()), doc, 'rendering must preserve the document');
              if (fixture.name === 'code-*') assert.equal(sample.visibleMarkers > 0, mode === 'live-active', 'code marker reveal follows selection');
            }
          } catch (error) { failures.push(`${theme}/${fixture.name}/${mode}: ${String(error)}`); }
        }
        if (fixture.name.startsWith('table-style-')) {
          const cell = 'tbody td:first-child .meo-md-html-table-cell-preview';
          await live.click(cell);
          const input = await live.evaluate(() => {
            const element = document.activeElement as HTMLTextAreaElement;
            return { tag: element.tagName, text: element.value };
          });
          assert.equal(input.tag, 'TEXTAREA', 'native table cell entered editing');
          assert.equal(input.text, fixture.markdown.split('\n')[2]!.slice(1, -1).trim(), 'table source preserves markers');
          await live.keyboard.press('Escape');
          await settle(live);
          const committed = await snapshot(live, '.cm-content');
          assert.deepEqual(committed.targets, [[...fixture.styles].sort()], 'native table cell restores formatting');
          assert.equal(await live.evaluate(() => (window as any).boundaryEditor.view.state.doc.toString()), doc, 'table editing preserves the document');
        }
      }
      console.log(`Inline boundaries: ${theme}, ${inlineSyntaxBoundaryFixtures.length} fixtures checked.`);
    }
  } finally { await browser.close(); }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Production Live/Preview inline syntax boundaries passed (inactive and selected, dark and light).');
}

try { await main(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
