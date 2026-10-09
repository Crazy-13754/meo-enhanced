import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchTestBrowser } from './browser-test-helpers';
import { buildPreviewStyles } from '../src/export/exportStyles';

const repoRoot = path.resolve(import.meta.dir, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-kbd-appearance-'));
const source = [
  '键帽样式', '',
  '点击右<kbd>侧单元</kbd>格末尾，按 <kbd>Ctrl</kbd>+Enter。', '',
  '> 引用里的 <kbd>回车</kbd>。', '',
  '- 列表中的 <kbd>Esc</kbd>。', '',
  '嵌套 HTML <strong>快捷键 <kbd>Enter</kbd></strong>。', '',
  '<p>HTML 中的 <kbd>回车</kbd> 和 <kbd>Ctrl</kbd>。</p>', '',
  '| 按键 |', '| --- |', '| 按 <kbd>回车</kbd> 和 <kbd>Ctrl</kbd> |', '',
  '<details open><summary>折叠标题 <kbd>Enter</kbd></summary><p>正文</p></details>'
].join('\n');

let browser: Awaited<ReturnType<typeof launchTestBrowser>> | undefined;
try {
  const build = await Bun.build({
    entrypoints: [path.join(import.meta.dir, 'test-kbd-appearance-entry.ts')],
    outdir: tempDir, target: 'browser', format: 'iife', naming: 'bundle.js'
  });
  if (!build.success) throw new Error(build.logs.map(String).join('\n'));
  browser = await launchTestBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1000 });
  await page.setContent('<!doctype html><div id="app"></div>');
  await page.addStyleTag({ path: path.join(repoRoot, 'webview/src/styles.css') });
  await page.addStyleTag({ content: ':root{--vscode-editor-font-weight:400;--vscode-font-family:Arial,sans-serif}#app{height:950px}.meo-md-html-table-cell-preview{min-width:300px}' });
  await page.addScriptTag({ path: path.join(tempDir, 'bundle.js') });
  for (const appearance of ['light', 'dark'] as const) {
    for (const font of ['Consolas', 'Arial', 'Microsoft YaHei']) {
      for (const size of [12, 16, 24]) {
        const result = await page.evaluate(async ({ appearance, font, size, source }) => {
          const api = (globalThis as any).KbdAppearanceHarness;
          const root = document.documentElement;
          root.style.setProperty('--vscode-editor-font-family', `"${font}", "Microsoft YaHei", sans-serif`);
          root.style.setProperty('--vscode-editor-font-size', `${size}px`);
          api.applyBuiltInVisualBaseline(appearance);
          const app = document.getElementById('app')!;
          const mount = (keys: boolean) => {
            const editor = api.createEditor({ parent: app, initialMode: 'live', uiLanguage: 'zh-CN',
              text: keys ? source : source.replace(/<\/?kbd>/g, ''), onApplyChanges() {} });
            return editor;
          };
          const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          const measure = () => Array.from(app.querySelectorAll('.cm-line, .meo-md-html-content p, .meo-md-html-content summary, .meo-md-html-table-cell-line'))
            .map(node => node.getBoundingClientRect().height);
          const plain = mount(false);
          await settle();
          const plainHeights = measure();
          plain.destroy();
          const editor = mount(true);
          await settle();
          const keyHeights = measure();
          const probe = () => {
            const span = document.createElement('span');
            span.style.cssText = 'display:inline-block;width:0;height:0;border:0;padding:0;margin:0;vertical-align:baseline';
            return span;
          };
          const keys = Array.from(app.querySelectorAll<HTMLElement>('kbd')).map(key => {
            const before = probe();
            key.before(before);
            const label = document.createElement('span');
            label.append(...Array.from(key.childNodes));
            key.append(label);
            const inner = probe();
            label.append(inner);
            const style = getComputedStyle(key);
            const result = { text: key.textContent, baseline: inner.getBoundingClientRect().top - before.getBoundingClientRect().top,
              color: style.color, fill: style.webkitTextFillColor, font: style.fontFamily };
            inner.remove(); before.remove(); label.replaceWith(...Array.from(label.childNodes));
            return result;
          });
          editor.destroy();
          return { plainHeights, keyHeights, keys };
        }, { appearance, font, size, source });
        const context = `${appearance}/${font}/${size}`;
        assert.equal(result.keys.length, 10, context);
        assert.deepEqual(result.keyHeights, result.plainHeights, `${context}: keycaps must preserve line heights`);
        for (const key of result.keys) {
          assert(Math.abs(key.baseline) < 0.1, `${context}/${key.text}: baseline offset ${key.baseline}px`);
          assert.equal(key.fill, key.color, `${context}/${key.text}: text fill must match foreground`);
          assert(key.font.startsWith('Consolas') && key.font.includes('Microsoft YaHei'), `${context}: include the prose fallback font`);
        }
      }
    }
    const preview = await browser.newPage();
    await preview.setContent('<p>按 <kbd>回车</kbd> 和 <kbd>Ctrl</kbd>。</p>');
    await preview.addStyleTag({ content: buildPreviewStyles({ editorFontFamily: 'Arial, "Microsoft YaHei", sans-serif', editorFontSizePx: 16 }, appearance) });
    const previewStyle = await preview.$eval('kbd', key => {
      const style = getComputedStyle(key);
      return { font: style.fontFamily, color: style.color, fill: style.webkitTextFillColor };
    });
    assert(previewStyle.font.startsWith('Consolas') && previewStyle.font.includes('Microsoft YaHei'));
    assert.equal(previewStyle.fill, previewStyle.color);
    await preview.close();
  }
  console.log('Kbd appearance passed: Chinese/Latin baselines, colors, line heights, and Preview font fallback.');
} finally {
  await browser?.close();
  assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
