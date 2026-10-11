import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import githubDark from '@shikijs/themes/github-dark';
import { launchTestBrowser, closeTestBrowser } from './browser-test-helpers';
import exportRuntime from '../src/export/runtime';
import { createHighlighter } from 'shiki';

const baseline = process.argv.includes('--baseline');
const nativeGrammar = process.env.MEO_VSCODE_MARKDOWN_GRAMMAR;
const output = path.resolve(process.env.MEO_THEME_OUTPUT ?? 'tmp/theme-acceptance');
fs.mkdirSync(output, { recursive: true });
const baselinePath = path.resolve('tmp/theme-content-before.json');
const markdown = [
  '---', 'title: Theme acceptance', 'count: 42', 'enabled: true', 'tags: [one, two]', '---', '',
  '# 编辑器配色验收 · Heading', '',
  '正文 **加粗** *斜体* ~~删除线~~ `inline code` [链接](https://example.com "Title")。', '',
  '- 列表项目', '- [x] 已完成任务', '- [ ] 未完成任务', '1. 有序列表', '',
  '> 引用 **重点** 和 `code`', '',
  '| Name | Value |', '| --- | --- |', '| Alpha | 42 |', '',
  '```typescript', '// Comment', 'const count: number = 42;', 'function greet(name: string) { return "Hello " + name; }', '```', '',
  '<div class="sample">HTML &amp; text</div>', '',
  'Setext heading', '--------------', '',
  '[ref]: https://example.com "Reference"', '[Reference][ref] ![Image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)', '',
  '***', '', '转义 \\*文字\\* &amp; https://example.com', '',
  '==highlight== [[Wiki]] #tag [^note]', '', '[^note]: Footnote', '',
  '```python', 'def sample(value):', '    return value + 1', '```'
].join('\n');
const outlineMarkdown = [
  '# 产品说明', '多章节目录验收：对比缩进、细线、当前章节与悬停样式。', '',
  '## 阅读与编辑', '三种编辑模式共享同一个文档。', '',
  '### 实时模式', '保留当前正文、标题和强调样式。', '',
  '### 源码模式', '显示 Markdown 标记和主题语法颜色。', '',
  '## 正文元素', '', '### 链接与强调', '**加粗**、*斜体*、`inline code` 与 [示例链接](https://example.com)。', '',
  '### 列表与引用', '- 列表内容', '- [x] 已完成项目', '> 引用内容', '',
  '# 主题与外观', '菜单栏与分段控件要有清楚的明暗层次。', '',
  '## 菜单与控件', '', '### 分段切换', '检查外框、选中块和未选中文字。', '',
  '### 下拉菜单', '检查普通状态、选中状态与键盘焦点。', '',
  '## 目录导航', '', '### 章节层级', '一级、二级和三级标题保留原有层次。', '',
  '### 阅读范围', '淡色背景提示当前可见的章节范围。', '',
  '# 内容排版', '', '## 表格与代码', '', '### 表格内容', '| 项目 | 状态 |', '| --- | --- |', '| 配色检查 | 完成 |', '',
  '### 代码示例', '```typescript', 'const theme = "editor";', '```', '',
  '## 图片与公式', '', '### 图片布局', '检查正文与侧边目录的背景衔接。', '',
  '### 公式排版', '行内公式 $a^2+b^2=c^2$。', '',
  '# 导出与快捷键', '', '## 文件导出', '预览预设与内容样式保持原样。', '',
  '## 常用操作', '使用快捷键切换、搜索和编辑文档。'
].join('\n');
const profiles = [
  { id: 'dark', kind: 'dark', theme: darkPlus, background: '#1f1f1f', widget: '#202020', foreground: '#cccccc', menu: '#1f1f1f', selection: '#0078d4' },
  { id: 'light', kind: 'light', theme: lightPlus, background: '#ffffff', widget: '#f8f8f8', foreground: '#333333', menu: '#ffffff', selection: '#0060c0' },
  { id: 'github-dark', kind: 'dark', theme: githubDark, background: '#24292e', widget: '#1f2428', foreground: '#e1e4e8', menu: '#1f2428', selection: '#044289' },
  { id: 'contrast-dark', kind: 'high-contrast', theme: darkPlus, background: '#000000', widget: '#0c141f', foreground: '#ffffff', menu: '#0c141f', selection: '#1aebff' },
  { id: 'contrast-light', kind: 'high-contrast-light', theme: lightPlus, background: '#ffffff', widget: '#ffffff', foreground: '#292929', menu: '#ffffff', selection: '#0f4a85' },
  { id: 'dark-on-light', kind: 'light', manual: 'dark', theme: lightPlus, background: '#ffffff', widget: '#f8f8f8', foreground: '#333333', menu: '#ffffff', selection: '#0060c0' },
  { id: 'light-on-dark', kind: 'dark', manual: 'light', theme: darkPlus, background: '#1f1f1f', widget: '#202020', foreground: '#cccccc', menu: '#1f1f1f', selection: '#0078d4' },
  { id: 'custom-dark', kind: 'dark', theme: darkPlus, background: '#17222b', widget: '#21313c', foreground: '#e0edf5', menu: '#21313c', selection: '#206665' }
];
// Theme fixtures stay portable and fixed; an installed Markdown grammar may
// independently replace Shiki's reference grammar for native syntax comparison.
const build = await Bun.build({ entrypoints: [baseline ? 'scripts/test-preview-reading-surface-production-entry.ts' : 'scripts/test-theme-inheritance-entry.ts'], target: 'browser', format: 'iife',
  plugins: baseline ? [{ name: 'committed-baseline', setup(build) {
    build.onLoad({ filter: /\.[cm]?tsx?$/ }, args => {
      const relative = path.relative(process.cwd(), args.path).replaceAll('\\', '/');
      if (!relative.startsWith('webview/src/') && !relative.startsWith('src/')) return;
      const result = Bun.spawnSync(['git', 'show', 'HEAD:' + relative]);
      if (result.exitCode === 0) return { contents: result.stdout.toString(), loader: 'ts' };
    });
  } }] : [] });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const bundle = await build.outputs[0]!.text();
const browser = await launchTestBrowser();
const referenceLanguage = nativeGrammar ? 'markdown-reference' : 'markdown';
const reference = await createHighlighter({ themes: [], langs: [nativeGrammar ? { ...JSON.parse(fs.readFileSync(nativeGrammar, 'utf8')), name: referenceLanguage } : 'markdown', 'yaml', 'html', 'html-derivative', 'typescript', 'python'] });
const content: Record<string, unknown> = {};
const errors: string[] = [];
try {
  const page = await browser.newPage();
  const screenshot = async (name: string) => {
    await page.evaluate(async () => {
      await Promise.all([...document.querySelectorAll('.segmented-control-button-indicator')]
        .flatMap(element => element.getAnimations()).map(animation => animation.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: path.join(output, name) });
  };
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.setViewport({ width: 1440, height: 1050 });
  await page.exposeFunction('__renderThemePreview', (message: any) => {
    if (message.type !== 'requestPreviewRender') return null;
    return { type: 'previewRenderResult', requestId: message.requestId, result: { ok: true, value: exportRuntime.renderPreviewDocument({
      markdownText: message.text, sourceDocumentPath: 'C:/tmp/theme.md', uiLanguage: message.uiLanguage,
      styleEnvironment: message.environment, preset: message.preset, contentWidth: message.contentWidth
    }) } };
  });
  for (const profile of profiles) {
    const light = profile.kind.includes('light');
    const appearance = light ? 'light' : 'dark';
    const theme = { name: profile.theme.name, type: appearance, colors: { ...profile.theme.colors, 'editor.foreground': profile.foreground, 'editor.background': profile.background }, tokenColors: profile.theme.tokenColors,
      ...(profile.id === 'custom-dark' ? { sourceColors: { ...profile.theme.colors, 'editor.foreground': profile.foreground }, sourceTokenColors: [...profile.theme.tokenColors, { scope: 'markup.heading.markdown punctuation.definition.heading.markdown', settings: { foreground: '#ff9933', fontStyle: '' } }, { scope: 'comment', settings: { foreground: '#92aebf', fontStyle: 'italic' } }] } : {})
    };
    const variables: Record<string, string> = {
      ...theme.colors,
      'editorWidget.background': profile.widget, 'editorWidget.foreground': profile.foreground,
      'menu.background': profile.menu, 'menu.foreground': profile.foreground, 'menu.border': light ? '#cecece' : '#454545',
      'menu.selectionBackground': profile.selection, 'menu.selectionForeground': profile.kind === 'high-contrast' ? '#000000' : '#ffffff', 'menu.selectionBorder': 'transparent',
      'dropdown.background': light ? '#ffffff' : '#313131', 'dropdown.foreground': profile.foreground, 'dropdown.border': light ? '#cecece' : '#454545',
      'dropdown.listBackground': profile.menu, 'input.background': light ? '#ffffff' : '#313131', 'input.foreground': profile.foreground,
      'input.border': light ? '#cecece' : '#454545', 'descriptionForeground': light ? '#666666' : '#9d9d9d',
      'focusBorder': profile.kind.includes('contrast') ? '#f38518' : profile.selection,
      'radio.activeBackground': profile.kind.includes('contrast') ? profile.background : light ? '#e1e4e8' : '#313131',
      'radio.activeForeground': profile.foreground, 'radio.activeBorder': profile.kind.includes('contrast') ? '#f38518' : 'transparent',
      'radio.inactiveBackground': profile.widget, 'radio.inactiveForeground': light ? '#6e6e6e' : '#9d9d9d', 'radio.inactiveBorder': 'transparent',
      'radio.inactiveHoverBackground': light ? '#e8e8e8' : '#2b2b2b',
      'toolbar.hoverBackground': light ? '#e8e8e8' : '#2b2b2b', 'toolbar.activeBackground': light ? '#dadada' : '#3a3a3a',
      'editorSuggestWidget.background': profile.menu, 'editorSuggestWidget.foreground': profile.foreground,
      'editorSuggestWidget.selectedBackground': profile.selection, 'editorSuggestWidget.selectedForeground': profile.kind === 'high-contrast' ? '#000000' : '#ffffff',
      'editorSuggestWidget.highlightForeground': light ? '#0066bf' : '#85b6ff', 'editorSuggestWidget.focusHighlightForeground': '#ffffff',
      'list.hoverBackground': light ? '#eeeeee' : '#2b2b2b', 'list.hoverForeground': profile.foreground,
      'list.activeSelectionBackground': profile.selection, 'list.activeSelectionForeground': profile.kind === 'high-contrast' ? '#000000' : '#ffffff',
      'editorLineNumber.foreground': light ? '#6e7681' : '#858585', 'editorLineNumber.activeForeground': profile.foreground,
      'editorCursor.foreground': profile.foreground, 'editor.selectionBackground': light ? '#add6ff' : '#264f78',
      'editor.lineHighlightBackground': light ? '#f4f4f4' : '#2a2a2a',
      ...(profile.kind.includes('contrast') ? { contrastBorder: '#f38518', contrastActiveBorder: '#f38518' } : {})
    };
    await page.setContent(`<!doctype html><style>html,body,#app{height:100%;margin:0}</style><body class="vscode-${profile.kind}"><div id="app"></div></body>`);
    await page.evaluate(variables => {
      const style = document.documentElement.style;
      for (const [id, value] of Object.entries(variables)) style.setProperty('--vscode-' + id.replace(/\./g, '-'), value);
      style.setProperty('--vscode-font-family', '"Segoe UI", sans-serif');
      style.setProperty('--vscode-editor-font-family', 'Consolas, monospace');
      style.setProperty('--vscode-editor-font-size', '15px');
      style.setProperty('--vscode-editor-font-weight', '400');
    }, variables);
    await page.addStyleTag({ content: baseline ? Bun.spawnSync(['git', 'show', 'HEAD:webview/src/styles.css']).stdout.toString() : fs.readFileSync('webview/src/styles.css', 'utf8') });
    await page.addScriptTag({ content: 'window.acquireVsCodeApi=()=>({getState(){return {}},setState(){},postMessage(message){window.__renderThemePreview(message).then(response=>{if(response)window.dispatchEvent(new MessageEvent("message",{data:response}));});}});' });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(init => window.dispatchEvent(new MessageEvent('message', { data: init })), {
      type: 'init', documentId: 'file:///theme.md', text: markdown, version: 1, savedRevision: { version: 1, text: markdown }, diagnostics: [],
      mode: 'live', uiLanguage: 'zh-CN', sourceLineNumbers: 'on', previewAppearance: 'auto', previewFontFamily: '', previewSourceColoring: false,
      previewShowComments: false, editorAppearance: 'manual' in profile ? profile.manual : 'auto', gitChangesGutter: false, gitDiffLineHighlights: false, gitDiffDetailsVisible: false,
      diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false, contentMaxWidthEnabled: false,
      findOptions: { wholeWord: false, caseSensitive: false }, outlinePosition: 'right', outlineVisible: true, outlineWidth: 240, vscodeTheme: theme
    });
    await page.waitForSelector('.cm-editor');
    await page.waitForFunction(() => !document.querySelector('.meo-preload-editor-shell') && getComputedStyle(document.querySelector('.editor-root')!).opacity !== '0');
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line span[style]')].some(el => el.textContent?.includes('const')));
    content[profile.id + ':live'] = await page.evaluate(() => {
      const selectors = ['.meo-md-h1', '.meo-md-strong', '.meo-md-em', '.meo-md-inline-code', '.meo-md-quote', '.meo-md-table-cell', '.meo-md-code-block', '.meo-md-code-block span[style]', '.meo-copy-code-btn'];
      return Object.fromEntries(selectors.map(selector => [selector, [...document.querySelectorAll(selector)].map(el => {
        const s = getComputedStyle(el); return [el.textContent, s.color, s.backgroundColor, s.borderColor, s.fontSize, s.fontWeight, s.fontStyle];
      })]));
    });
    await screenshot(profile.id + '-live.png');
    await page.click('button[data-mode="preview"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.editor-root')?.dataset.mode === 'preview');
    await page.waitForFunction(() => !!document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('h1'));
    content[profile.id + ':preview'] = await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!;
      return [...doc.querySelectorAll('body,h1,p,strong,em,code,code span,blockquote,table,th,td,pre')].map(el => {
        const s = doc.defaultView!.getComputedStyle(el); return [el.tagName, el.textContent, s.color, s.backgroundColor, s.borderColor, s.fontSize, s.fontWeight, s.fontStyle];
      });
    });
    await screenshot(profile.id + '-preview.png');
    await page.click('button[data-mode="source"]');
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.editor-root')?.dataset.mode === 'source');
    if (!baseline) {
      const controls = await page.evaluate(() => {
        const read = (selector: string, property: 'color' | 'backgroundColor' | 'borderTopColor' = 'color') => getComputedStyle(document.querySelector(selector)!)[property];
        const role = (name: string) => {
          const probe = document.createElement('span'); probe.style.color = `var(${name})`; document.body.append(probe);
          const value = getComputedStyle(probe).color; probe.remove(); return value;
        };
        const button = document.querySelector('.source-preview-button')!;
        const inactive = read('.source-preview-button');
        button.classList.add('is-active');
        const active = read('.source-preview-button'), activeBackground = read('.source-preview-button', 'backgroundColor');
        button.classList.remove('is-active');
        return { inactive, active, activeBackground, icon: read('.source-preview-button > svg'),
          inline: read('.selection-inline-button'), menu: read('.source-preview-more-panel'), menuBackground: read('.source-preview-more-panel', 'backgroundColor'),
          muted: role('--meo-ui-text-muted'), foreground: role('--meo-ui-text'), hover: role('--meo-ui-surface-hover'),
          iconForeground: role('--meo-ui-text'), menuForeground: role('--meo-ui-text'), menuSurface: role('--meo-ui-surface-raised') };
      });
      assert.equal(controls.inactive, controls.foreground, `${profile.id}: Source preview button shares the ordinary toolbar foreground`);
      assert.equal(controls.active, controls.foreground, `${profile.id}: Source preview button active text`);
      assert.equal(controls.activeBackground, controls.hover, `${profile.id}: Source preview button active surface`);
      assert.equal(controls.icon, controls.iconForeground, `${profile.id}: Source preview icon`);
      assert.equal(controls.inline, controls.menuForeground, `${profile.id}: selected-text toolbar button`);
      assert.equal(controls.menu, controls.menuForeground, `${profile.id}: Source preview menu text`);
      assert.equal(controls.menuBackground, controls.menuSurface, `${profile.id}: Source preview menu background`);
      const foregroundChannels = controls.foreground.match(/\d+/g)!.map(Number);
      assert.equal(foregroundChannels[0], foregroundChannels[1], `${profile.id}: ordinary UI foreground is neutral`);
      assert.equal(foregroundChannels[1], foregroundChannels[2], `${profile.id}: ordinary UI icons share the neutral foreground`);
      if (profile.id === 'dark') {
        const palette = await page.evaluate(() => {
          const root = document.documentElement, style = root.style;
          const read = () => Object.fromEntries([...style].filter(name => name.startsWith('--meo-ui-')).map(name => [name, style.getPropertyValue(name)]));
          const before = read(), oldMenu = style.getPropertyValue('--vscode-menu-background'), oldWidget = style.getPropertyValue('--vscode-editorWidget-background');
          const refresh = () => (window as any).ThemeAcceptance.refreshUiTheme();
          refresh(); const reused = read();
          style.setProperty('--vscode-menu-background', '#ff00ff'); refresh(); const independent = read();
          style.setProperty('--vscode-editorWidget-background', '#122b38'); refresh(); const changed = read();
          style.setProperty('--vscode-menu-background', oldMenu); style.setProperty('--vscode-editorWidget-background', oldWidget); refresh();
          return { before, reused, independent, changed, restored: read() };
        });
        assert.deepEqual(palette.reused, palette.before, 'Reapplying identical inputs preserves all UI roles');
        assert.deepEqual(palette.independent, palette.before, 'Floating UI derives from the toolbar base independently of native menu fills');
        assert.notEqual(palette.changed['--meo-ui-surface'], palette.before['--meo-ui-surface'], 'Changing the shared base invalidates the resolved palette');
        assert.notEqual(palette.changed['--meo-ui-surface-raised'], palette.before['--meo-ui-surface-raised'], 'Floating UI follows the changed shared base');
        assert.deepEqual(palette.restored, palette.before, 'Restoring shared inputs restores the entire palette');
      }
      await page.waitForSelector('.meo-source-token', { timeout: 10000 }).catch(async error => {
        console.log(await page.evaluate(() => ({ mode: document.querySelector('.editor-root')?.getAttribute('data-mode'), lines: document.querySelectorAll('.cm-line').length, html: document.querySelector('.cm-editor')?.outerHTML.slice(0, 1200) })));
        throw error;
      });
      const sourceTheme = 'manual' in profile ? profile.manual === 'light' ? lightPlus : darkPlus : { ...theme, colors: 'sourceColors' in theme ? theme.sourceColors : theme.colors, tokenColors: 'sourceTokenColors' in theme ? theme.sourceTokenColors : theme.tokenColors };
      const referenceTheme = { ...structuredClone(sourceTheme), name: 'reference-' + profile.id };
      await reference.loadTheme(referenceTheme as any);
      const expected = reference.codeToTokens(markdown, { lang: referenceLanguage, theme: referenceTheme.name }).tokens;
      // Compare every rendered character against TextMate, rather than sampling a few guessed token groups.
      const readSourceLines = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map(line => {
        const chars: { color: string; weight: string; italic: string; underline: string }[] = [];
        const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) {
          const text = walk.currentNode; const s = getComputedStyle(text.parentElement!);
          for (let i = 0; i < text.textContent!.length; i++) chars.push({ color: s.color, weight: s.fontWeight, italic: s.fontStyle, underline: s.textDecorationLine });
        }
        return { index: (window as any).ThemeAcceptance.lineIndex(line), text: line.textContent, chars };
      }));
      const actual = await readSourceLines();
      await page.evaluate(() => { const scroller = document.querySelector<HTMLElement>('.cm-scroller')!; scroller.scrollTop = scroller.scrollHeight; });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      actual.push(...await readSourceLines());
      for (const line of actual) {
        const index = line.index;
        if (index < 0) continue;
        const tokens = expected[index]!;
        let offset = 0;
        for (const token of tokens) for (let i = 0; i < token.content.length; i++) {
          const color = token.color!.replace('#', '');
          const rgb = `rgb(${parseInt(color.slice(0, 2), 16)}, ${parseInt(color.slice(2, 4), 16)}, ${parseInt(color.slice(4, 6), 16)})`;
          assert.equal(line.chars[offset]?.color, rgb, `${profile.id}: ${line.text} character ${offset}`);
          assert.equal(line.chars[offset]?.weight, token.fontStyle! & 2 ? '700' : '400', `${profile.id}: font weight ${line.text}:${offset}`);
          assert.equal(line.chars[offset]?.italic, token.fontStyle! & 1 ? 'italic' : 'normal', `${profile.id}: italic ${line.text}:${offset}`);
          assert.equal(line.chars[offset]?.underline.includes('underline'), !!(token.fontStyle! & 4), `${profile.id}: underline ${line.text}:${offset}`);
          assert.equal(line.chars[offset]?.underline.includes('line-through'), !!(token.fontStyle! & 8), `${profile.id}: strike ${line.text}:${offset}`);
          offset++;
        }
      }
      await screenshot(profile.id + '-source-tail.png');
      await page.evaluate(() => { document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop = 0; });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.equal(await page.$eval('.mode-toolbar', el => getComputedStyle(el).backgroundColor), await page.evaluate(() => {
        const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--meo-ui-surface)'; document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color;
      }), `${profile.id}: toolbar uses the shared derived surface`);
    }
    await page.waitForFunction(() => document.querySelector<HTMLElement>('.preview-host')?.hidden === true && !document.querySelector('[data-preview-cover]'));
    await screenshot(profile.id + '-source.png');
    await page.click('.more-tools-wrapper > .format-button');
    if (!baseline) {
      const toolbar = await page.$eval('.mode-toolbar', el => getComputedStyle(el).backgroundColor);
      for (const selector of ['.toolbar-right', '.toolbar-overflow-indicator']) {
        assert.equal(await page.$eval(selector, el => getComputedStyle(el).backgroundColor), toolbar, `${profile.id}: ${selector} shares the toolbar surface`);
      }
      const knobs = await page.$$eval('.more-tools-panel .menu-switch', switches => {
        const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--meo-ui-on-switch-off)'; document.body.append(probe);
        const off = getComputedStyle(probe).backgroundColor; probe.remove();
        return switches.map(el => ({ checked: el.parentElement?.getAttribute('aria-checked') === 'true',
          color: getComputedStyle(el, '::after').backgroundColor, shadow: getComputedStyle(el).boxShadow, off }));
      });
      assert.ok(knobs.length > 0);
      assert.ok(knobs.every(knob => knob.color === (knob.checked ? 'rgb(255, 255, 255)' : knob.off)), `${profile.id}: switches use white when on and derived gray when off`);
      assert.ok(knobs.every(knob => knob.shadow === 'none'), `${profile.id}: switches have no permanent outline`);
    }
    await screenshot(profile.id + '-menu.png');
    if (!baseline) {
      await page.click('.more-tools-settings-button');
      await page.waitForSelector('.settings-window[open]');
      await screenshot(profile.id + '-settings.png');
      await page.click('.settings-close');
      await page.click('button[data-mode="live"]');
      await page.waitForSelector('.cm-editor.meo-mode-live');
      await page.waitForFunction(() => document.querySelector<HTMLElement>('.preview-host')?.hidden === true);
      await page.hover('.table-wrapper > .format-button');
      await page.mouse.move(300, 95);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.table-dropdown-wrapper')!).opacity === '1');
      await screenshot(profile.id + '-table-insert.png');
      if (profile.id === 'dark' || profile.id === 'light') {
        await page.mouse.move(700, 450);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.table-dropdown-wrapper')!).opacity === '0');
        await page.evaluate(() => {
          const text = '# 主题控件验收\n\n调色面板 #60A5FA 与 #60A5FA80\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n';
          (window as any).ThemeAcceptance.replaceText(text, 'end');
        });
        await page.waitForSelector('.meo-md-color-swatch-interactive');
        await page.click('.meo-md-color-swatch-interactive');
        await page.waitForSelector('.meo-hex-color-adjustment');
        await screenshot(profile.id + '-color-picker.png');
        await page.click('.meo-hex-color-adjustment-close');
        await page.waitForSelector('.meo-md-html-table textarea');
        await page.click('.meo-md-html-table textarea');
        await page.waitForSelector('.meo-md-html-table-context-trigger', { visible: true });
        await page.click('.meo-md-html-table-context-trigger');
        await page.waitForSelector('.meo-md-html-table-context-menu:not([hidden])');
        await screenshot(profile.id + '-table-menu.png');
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
          (window as any).ThemeAcceptance.focusEnd();
        });
        await page.keyboard.type('/');
        await page.waitForSelector('.meo-input-suggestions:not([hidden])');
        await screenshot(profile.id + '-slash.png');
        await page.keyboard.press('Escape');
      }
      await page.click('button[data-mode="live"]');
      await page.waitForSelector('.cm-editor.meo-mode-live');
      await page.evaluate(text => {
        (window as any).ThemeAcceptance.replaceText(text);
        document.querySelector<HTMLElement>('.cm-scroller')!.scrollTop = 0;
      }, outlineMarkdown);
      await page.waitForFunction(() => document.querySelectorAll('.outline-item').length >= 20 && !!document.querySelector('.outline-item.is-visible-first'));
      await page.mouse.move(700, 900);
      {
        const surfaces = await page.evaluate(() => {
          const read = (selector: string, property = 'backgroundColor') => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d')!;
            context.fillStyle = getComputedStyle(document.querySelector(selector)!).getPropertyValue(property === 'backgroundColor' ? 'background-color' : property);
            context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data];
          };
          const wrapper = document.querySelector<HTMLElement>('.editor-wrapper')!;
          const fixed = read('.outline-sidebar');
          const mode = wrapper.dataset.outlineMode;
          wrapper.dataset.outlineMode = 'floating';
          const floating = read('.outline-sidebar');
          wrapper.dataset.outlineMode = mode;
          return { fixed, floating, content: read('.editor-host'), toolbar: read('.mode-toolbar'),
            track: read('.mode-group.segmented-control'), indicator: read('.mode-group .is-active .segmented-control-button-indicator'),
            activeChapter: read('.outline-item.is-visible-first'),
            selectedText: read('.mode-group .is-active', 'color'),
            selectedShadow: getComputedStyle(document.querySelector('.mode-group .is-active .segmented-control-button-indicator')!).boxShadow };
        });
        assert.deepEqual(surfaces.fixed, surfaces.content, `${profile.id}: outline and content backgrounds`);
        assert.deepEqual(surfaces.floating, surfaces.content, `${profile.id}: floating outline and content backgrounds`);
        assert.equal(surfaces.activeChapter[3], 0, `${profile.id}: current chapter uses the original transparent item background`);
        const luminance = (color: number[]) => color.slice(0, 3).map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
        const contrast = (left: number[], right: number[]) => { const a = luminance(left), b = luminance(right); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        if (profile.kind.includes('contrast')) {
          assert.deepEqual(surfaces.track, surfaces.toolbar, `${profile.id}: high contrast keeps the shared native surface`);
          assert.ok(surfaces.selectedShadow.includes('rgb(243, 133, 24)') && surfaces.selectedShadow.includes('inset'),
            `${profile.id}: selected segment needs the explicit native contrast border`);
          assert.ok(contrast(surfaces.selectedText, surfaces.indicator) >= 4.5, `${profile.id}: native selection text remains readable`);
        } else {
          assert.ok(contrast(surfaces.track, surfaces.toolbar) >= 1.2, `${profile.id}: segmented track must stand apart from toolbar`);
        }
        assert.ok(contrast(surfaces.indicator, surfaces.track) >= 1.2, `${profile.id}: selected segment must stand apart from track`);
      }
      await screenshot(profile.id + '-outline-live.png');
      await page.hover('.outline-item.outline-level-3');
      {
        const alpha = await page.$eval('.outline-item.outline-level-3:hover', el => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!; context.fillStyle = getComputedStyle(el).backgroundColor;
          context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3]!;
        });
        assert.ok(alpha > 0 && alpha < 32, 'Outline hover keeps its subtle original surface');
      }
      await screenshot(profile.id + '-outline-hover.png');
      await page.mouse.move(700, 900);
      await page.click('button[data-mode="source"]');
      await page.waitForFunction(() => document.querySelector('.cm-editor.meo-mode-source .meo-source-token')?.textContent?.includes('产品说明') === true || [...document.querySelectorAll('.cm-editor.meo-mode-source .meo-source-token')].some(el => el.textContent?.includes('产品说明')));
      assert.equal(await page.$eval('.outline-sidebar', el => getComputedStyle(el).backgroundColor), await page.$eval('.editor-host', el => getComputedStyle(el).backgroundColor));
      await screenshot(profile.id + '-outline-source.png');
      await page.click('button[data-mode="preview"]');
      await page.waitForFunction(() => document.querySelector<HTMLElement>('.editor-root')?.dataset.mode === 'preview' && document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.querySelector('h1')?.textContent === '产品说明');
      assert.equal(await page.$eval('.outline-sidebar', el => getComputedStyle(el).backgroundColor), await page.$eval('.editor-host', el => getComputedStyle(el).backgroundColor), `${profile.id}: outline retains the Live/Source background in Preview`);
      await screenshot(profile.id + '-outline-preview.png');
      if (profile.id === 'dark' || profile.id === 'light') {
        const previousBackground = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!; return frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).backgroundColor; });
        const outlineForeground = await page.$eval('.outline-header-label', el => getComputedStyle(el).color);
        await page.click(`[data-preview-appearance-choice="${profile.id === 'dark' ? 'light' : 'dark'}"]`);
        await page.waitForFunction(previous => {
          const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!;
          const color = frame.contentWindow?.getComputedStyle(frame.contentDocument!.body).backgroundColor;
          return color && color !== previous;
        }, {}, previousBackground);
        assert.equal(await page.$eval('.outline-sidebar', el => getComputedStyle(el).backgroundColor), await page.$eval('.editor-host', el => getComputedStyle(el).backgroundColor), 'Manual Preview appearance must not recolor the outline background');
        assert.equal(await page.$eval('.outline-header-label', el => getComputedStyle(el).color), outlineForeground, 'Manual Preview appearance must not recolor outline text');
        await screenshot(profile.id + '-outline-preview-opposite.png');
        await page.click('button[data-mode="live"]');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.outline-sidebar')!).backgroundColor === getComputedStyle(document.querySelector('.editor-host')!).backgroundColor);
        assert.equal(await page.$eval('.outline-sidebar', el => (el as HTMLElement).style.getPropertyValue('--meo-outline-foreground')), '', 'Outline text has no Preview-specific color override');
      }
    }
  }
  if (baseline) fs.writeFileSync(baselinePath, JSON.stringify(content, null, 2));
  else {
    fs.writeFileSync(path.join(output, 'content-observed.json'), JSON.stringify(content, null, 2));
    // These fixed fingerprints were captured from the pre-change commit. A
    // normal run must never refresh its oracle from the version under test.
    const expectedContent = JSON.parse(fs.readFileSync('scripts/fixtures/theme-content-baseline.json', 'utf8'));
    assert.deepEqual(Object.keys(content), Object.keys(expectedContent.hashes));
    for (const [profile, styles] of Object.entries(content)) {
      const fingerprint = createHash('sha256').update(JSON.stringify(styles)).digest('hex');
      assert.equal(fingerprint, expectedContent.hashes[profile], `${profile}: Live/Preview content styles differ from ${expectedContent.baseCommit}`);
    }
    await page.click('button[data-mode="source"]');
    await page.waitForSelector('.cm-editor.meo-mode-source');
    await page.evaluate(() => {
      const text = '# Pending theme\n\n' + '> Text **bold** `code`\n'.repeat(700);
      (window as any).ThemeAcceptance.replaceText(text);
      document.documentElement.style.setProperty('--vscode-radio-activeBackground', 'transparent');
      document.documentElement.style.setProperty('--vscode-editor-foreground', '#ccffdd');
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'vscodeCodeThemeChanged', appearance: 'dark', vscodeTheme: {
        name: 'Runtime theme', type: 'dark', colors: { 'editor.foreground': '#ccffdd' }, tokenColors: [{ scope: 'markup.heading', settings: { foreground: '#ff9933', fontStyle: 'bold' } }]
      } } }));
      (window as any).ThemeAcceptance.replaceText('# Final theme\n\nOnly the latest document may publish.');
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.meo-source-token')].some(el => el.textContent?.includes('Final theme') && getComputedStyle(el).color === 'rgb(255, 153, 51)'));
    assert.notEqual(await page.evaluate(() => {
      const probe = document.createElement('span'); probe.style.background = 'var(--meo-ui-surface-selected)'; document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color;
    }), 'rgba(0, 0, 0, 0)', 'Derived selected UI remains visible independently of transparent native radio tokens');
    assert.notEqual(await page.$eval('.segmented-control-button.is-active .segmented-control-button-indicator', el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Segmented controls keep a distinct surface even with a transparent native radio token');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vscode-editor-foreground')), '#ccffdd', 'Theme transitions must preserve native variables');
    await screenshot('runtime-theme-source.png');
    await page.evaluate(() => document.documentElement.style.removeProperty('--vscode-radio-activeBackground'));
    await screenshot('runtime-fallback-source.png');
  }
  assert.deepEqual(errors, []);
  console.log(baseline ? 'Captured content baseline and full-window screenshots.' : 'Theme inheritance: Source character colors/styles and Live/Preview preservation passed.');
} finally { reference.dispose(); await closeTestBrowser(browser); }
