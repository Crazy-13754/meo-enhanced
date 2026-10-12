import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { launchTestBrowser } from './browser-test-helpers';

const repoRoot = path.resolve(import.meta.dir, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meo-changes-review-consistency-'));

async function waitForFrames(page: Page, count = 4): Promise<void> {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

async function assertCountsMatchMarkers(page: Page, label: string): Promise<void> {
  const projection = await page.evaluate(() => ({
    counts: document.querySelector('.changes-review-trigger .changes-review-counts')?.textContent,
    markers: document.querySelectorAll('.meo-git-gutter-marker.is-modified').length
  }));
  if (projection.counts !== '+1−1' || projection.markers !== 1) {
    throw new Error(`${label} desynchronized counts and markers: ${JSON.stringify(projection)}`);
  }
}

async function main(): Promise<void> {
  const build = await Bun.build({
    entrypoints: [path.join(repoRoot, 'scripts', 'test-webview-viewport-entry.ts')],
    outdir: tempDir,
    target: 'browser',
    format: 'iife',
    naming: 'bundle.js'
  });
  if (!build.success) throw new Error(build.logs.map(String).join('\n'));

  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 520, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><body class="vscode-dark"><div id="app" class="editor-root">
      <div class="mode-toolbar meo-preload-toolbar" role="presentation" aria-hidden="true"></div>
      <div class="editor-wrapper meo-preload-editor-shell" role="presentation" aria-hidden="true">
        <div class="editor-host"></div>
      </div>
    </div></body>`);
    await page.addStyleTag({
      content: ':root{--vscode-editor-background:#24292e;--vscode-editor-foreground:#e6edf3;--vscode-sideBar-background:#1f2428;--vscode-panel-border:#474b50;--vscode-toolbar-hoverBackground:#343b43}html,body,#app{height:100%;margin:0}#app{display:flex;flex-direction:column}'
    });
    await page.addStyleTag({ path: path.join(repoRoot, 'webview', 'src', 'styles.css') });
    await page.addScriptTag({ content: `
      window.__hostMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage(message) { window.__hostMessages.push(message); },
        getState() { return window.__webviewState; },
        setState(state) { window.__webviewState = state; }
      });
    ` });
    await page.addScriptTag({ path: path.join(tempDir, 'bundle.js') });

    const precedingText = `<a href="./markdown-render-test.md#html-jump-target" title="打开当前文件并跳转">相对文件锚点</a>`;
    const currentText = `first\n${precedingText}\nnew value ${'long-source-path/'.repeat(20)}\nlast`;
    const baselineText = `first\n${precedingText}\nold value ${'old-source-path/'.repeat(20)}\nlast`;
    await page.evaluate((text) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'init', documentId: 'file:///changes.md', text, version: 1,
        savedRevision: { version: 1, text }, diagnostics: [], mode: 'source',
        uiLanguage: 'zh-CN', sourceLineNumbers: 'on', previewAppearance: 'dark',
        previewFontFamily: '', previewSourceColoring: true, editorAppearance: 'dark',
        editorFontSizeMode: 'auto', editorFontSize: 14,
        gitChangesGutter: true, gitDiffLineHighlights: false, gitDiffDetailsVisible: false,
        diffBaselineMode: 'current-edit', fixedBaselinePinned: false, fixedBaselineActive: false,
        contentMaxWidthEnabled: false, findOptions: { wholeWord: false, caseSensitive: false },
        outlinePosition: 'right', outlineVisible: false, outlineWidth: 260, vscodeTheme: null
      }}));
    }, currentText);
    await page.waitForSelector('.editor-host > .cm-editor');

    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: {
          available: true, tracked: true, mode: 'current-edit', generation: 1, baseText
        }
      }}));
    }, baselineText);
    await waitForFrames(page);
    await assertCountsMatchMarkers(page, 'Current disk baseline');

    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'diffBaselineModeChanged', mode: 'recent-save'
      }}));
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: {
          available: true, tracked: true, mode: 'recent-save', generation: 2, baseText
        }
      }}));
    }, baselineText);
    await waitForFrames(page);
    await assertCountsMatchMarkers(page, 'Before Agent edits baseline');

    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'diffBaselineModeChanged', mode: 'git-head'
      }}));
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: {
          available: true, tracked: true, mode: 'git-head', generation: 3,
          headOid: 'abc123', baseText
        }
      }}));
    }, baselineText);
    await waitForFrames(page);
    await assertCountsMatchMarkers(page, 'Git HEAD baseline');

    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'fixedBaselineChanged', pinned: true, active: true, updatedAt: 1_000
      }}));
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: {
          available: true, tracked: true, mode: 'fixed', generation: 4, baseText
        }
      }}));
    }, baselineText);
    await waitForFrames(page);
    await assertCountsMatchMarkers(page, 'Manual snapshot baseline');

    await page.waitForFunction(() => !document.querySelector('.mode-toolbar')?.classList.contains('meo-preload-toolbar'));
    await page.click('.changes-review-trigger');
    const hoverHintCount = await page.evaluate(() => document.querySelectorAll(
      '.changes-review-option-info, .changes-review-option-tooltip, .changes-review-control [title]'
    ).length);
    if (hoverHintCount !== 0) throw new Error(`Changes menu still has hover hints: ${hoverHintCount}`);
    const changesMenuGeometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.changes-review-panel')!;
      const header = panel.querySelector<HTMLElement>('.changes-review-header')!;
      const displaySection = panel.querySelectorAll<HTMLElement>('.changes-review-section')[1]!;
      const panelRect = panel.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const sectionRect = displaySection.getBoundingClientRect();
      const lastOptionRect = displaySection.querySelector('.changes-review-toggle')!.getBoundingClientRect();
      const headerDivider = getComputedStyle(header, '::after');
      const sectionDivider = getComputedStyle(displaySection, '::before');
      const children = Array.from(header.children, (child) => child.getBoundingClientRect());
      const contentTop = Math.min(...children.map((rect) => rect.top));
      const contentBottom = Math.max(...children.map((rect) => rect.bottom));
      return {
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        lastOptionLeftInset: lastOptionRect.left - panelRect.left,
        lastOptionRightInset: panelRect.right - lastOptionRect.right,
        lastOptionBottomInset: panelRect.bottom - lastOptionRect.bottom,
        headerDividerLeft: headerRect.left + (Number.parseFloat(headerDivider.left) || 0),
        headerDividerRight: headerRect.right - (Number.parseFloat(headerDivider.right) || 0),
        sectionDividerLeft: sectionRect.left + (Number.parseFloat(sectionDivider.left) || 0),
        sectionDividerRight: sectionRect.right - (Number.parseFloat(sectionDivider.right) || 0),
        headerContentCenterOffset: (contentTop + contentBottom) / 2
          - (panelRect.top + Number.parseFloat(getComputedStyle(panel).borderTopWidth)
            + headerRect.bottom - Number.parseFloat(headerDivider.height)) / 2,
        headerDividerHeight: headerDivider.height,
        headerDividerOpacity: headerDivider.opacity,
        sectionDividerHeight: sectionDivider.height,
        sectionDividerOpacity: sectionDivider.opacity,
        headerFont: getComputedStyle(header).fontSize,
        optionFont: getComputedStyle(panel.querySelector('.changes-review-option')!).fontSize
      };
    });
    await page.click('.changes-review-trigger');
    await page.click('.more-tools-wrapper > button');
    const settingsMenuGeometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.more-tools-panel')!;
      const separator = panel.querySelector<HTMLElement>('.more-tools-separator')!;
      const panelRect = panel.getBoundingClientRect();
      const separatorRect = separator.getBoundingClientRect();
      return {
        leftInset: separatorRect.left - panelRect.left,
        rightInset: panelRect.right - separatorRect.right
      };
    });
    const expectedLeft = changesMenuGeometry.panelLeft + settingsMenuGeometry.leftInset;
    const expectedRight = changesMenuGeometry.panelRight - settingsMenuGeometry.rightInset;
    if (
      Math.abs(changesMenuGeometry.lastOptionBottomInset - changesMenuGeometry.lastOptionLeftInset) > 0.5 ||
      Math.abs(changesMenuGeometry.lastOptionBottomInset - changesMenuGeometry.lastOptionRightInset) > 0.5 ||
      Math.abs(changesMenuGeometry.headerDividerLeft - expectedLeft) > 0.5 ||
      Math.abs(changesMenuGeometry.headerDividerRight - expectedRight) > 0.5 ||
      Math.abs(changesMenuGeometry.sectionDividerLeft - expectedLeft) > 0.5 ||
      Math.abs(changesMenuGeometry.sectionDividerRight - expectedRight) > 0.5 ||
      Math.abs(changesMenuGeometry.headerContentCenterOffset) > 0.25 ||
      changesMenuGeometry.headerDividerHeight !== changesMenuGeometry.sectionDividerHeight ||
      changesMenuGeometry.headerDividerOpacity !== changesMenuGeometry.sectionDividerOpacity ||
      changesMenuGeometry.headerFont !== changesMenuGeometry.optionFont
    ) {
      throw new Error(`Changes menu alignment did not match Settings: ${JSON.stringify({
        changesMenuGeometry,
        settingsMenuGeometry
      })}`);
    }

    await page.click('.more-tools-wrapper > button');
    await page.click('.changes-review-trigger');
    await page.click('[data-toggle="before-content"]');
    await waitForFrames(page, 4);
    await page.click('[data-baseline="none"]');
    await waitForFrames(page, 4);
    const assertComparisonOff = async () => {
      const projection = await page.evaluate(() => ({
        counts: document.querySelector('.changes-review-trigger .changes-review-counts')?.textContent,
        rows: document.querySelectorAll('.meo-git-diff-original-line, .meo-diff-changed-line, .meo-diff-added-line').length,
        toggleChecked: document.querySelector('[data-toggle="before-content"]')?.getAttribute('aria-checked'),
        toggleDisabled: document.querySelector<HTMLButtonElement>('[data-toggle="before-content"]')?.disabled,
        selected: document.querySelector('[data-baseline="none"]')?.getAttribute('aria-checked')
      }));
      if (projection.counts !== '不比较' || projection.rows || projection.toggleChecked !== 'true'
        || !projection.toggleDisabled || projection.selected !== 'true') {
        throw new Error(`Comparison off did not clear the projection while retaining preferences: ${JSON.stringify(projection)}`);
      }
    };
    await assertComparisonOff();
    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: { available: true, tracked: true, mode: 'fixed', generation: 5, baseText }
      }}));
    }, baselineText);
    await waitForFrames(page, 4);
    await assertComparisonOff();
    await page.click('[data-action="select-snapshot"]');
    await page.evaluate((baseText) => {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'gitBaselineChanged', version: 1,
        payload: { available: true, tracked: true, mode: 'fixed', generation: 6, baseText }
      }}));
    }, baselineText);
    await waitForFrames(page, 4);
    await assertCountsMatchMarkers(page, 'Reenabled snapshot baseline');
    if (await page.$eval('[data-toggle="before-content"]', (button) => (button as HTMLButtonElement).disabled)) {
      throw new Error('Original-content preference did not reactivate with comparison');
    }
    await page.click('.changes-review-trigger');
    await page.setViewport({ width: 1400, height: 520, deviceScaleFactor: 1 });
    await waitForFrames(page, 12);
    await page.click('.more-tools-wrapper > button');
    // Assert each transition, including number-only changes that rewrap the
    // preceding line without resizing the full-width scroll container.
    for (const action of ['contentMaxWidth', 'sourceLineNumbers', 'sourceLineNumbers', 'contentMaxWidth',
      'sourceLineNumbers', 'contentMaxWidth', 'sourceLineNumbers', 'contentMaxWidth', 'contentMaxWidth']) {
      await page.click(`[data-action="${action}"]`);
      await waitForFrames(page, 8);
      const layout = await page.evaluate(() => (['original', 'current'] as const).map((kind) => {
        const row = document.querySelector<HTMLElement>(`.meo-git-diff-${kind}-line`)!.getBoundingClientRect();
        const gutter = document.querySelector<HTMLElement>(`.meo-git-diff-sign-gutter-cell.is-${kind}`)!.getBoundingClientRect();
        return { kind, top: row.top - gutter.top, height: row.height - gutter.height };
      }));
      if (layout.some((row) => Math.abs(row.top) > 1 || Math.abs(row.height) > 1)) {
        throw new Error(`Settings ${action} toggle left stale diff gutter heights: ${JSON.stringify(layout)}`);
      }
    }

    await page.click('.editor-appearance-button[data-editor-appearance="auto"]');
    await page.click('.more-tools-wrapper > button');
    for (const appearance of ['dark', 'light'] as const) {
      await page.evaluate(appearance => {
        document.body.className = `vscode-${appearance}`;
        document.documentElement.style.setProperty('--vscode-editor-background', appearance === 'dark' ? '#24292e' : '#ffffff');
        document.documentElement.style.setProperty('--vscode-editor-foreground', appearance === 'dark' ? '#e6edf3' : '#202020');
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'vscodeCodeThemeChanged', appearance, vscodeTheme: { name: 'fixture', type: appearance, colors: {}, tokenColors: [] }
        }}));
      }, appearance);
      await waitForFrames(page);
      assert.equal(await page.$eval('html', element => (element as HTMLElement).dataset.editorAppearance), appearance);
      await page.click('.changes-review-trigger');
      const readCounts = () => page.evaluate(() => {
        const role = (name: string) => {
          const probe = document.createElement('span'); probe.style.color = `var(--meo-ui-${name})`; document.body.append(probe);
          const color = getComputedStyle(probe).color; probe.remove(); return color;
        };
        return {
          backgrounds: ['surface', 'surface-raised', 'surface-hover'].map(role),
          rows: [...document.querySelectorAll('.changes-review-count')].map(element => {
            const name = element.classList.contains('is-added') ? 'success' : 'danger';
            return { color: getComputedStyle(element).color, expected: role(`${name}-emphasis`), original: role(name) };
          })
        };
      });
      const idle = await readCounts();
      assert.equal(idle.rows.length, 4, `${appearance}: trigger and menu both show additions/deletions`);
      const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => color.startsWith('color(srgb') ? channel * 255 : channel);
      const saturation = (color: string) => {
        const rgb = channels(color); return (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
      };
      const luminance = (color: string) => channels(color).map(channel => {
        const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
      const contrast = (color: string, background: string) => {
        const a = luminance(color), b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      for (const row of idle.rows) {
        assert.equal(row.color, row.expected, `${appearance}: counts use the stronger semantic color`);
        assert.ok(saturation(row.color) >= saturation(row.original), `${appearance}: counts retain the vivid semantic saturation (${JSON.stringify(row)})`);
        for (const background of idle.backgrounds) {
          const a = luminance(row.color), b = luminance(background);
          assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${appearance}: counts remain readable on ${background}`);
        }
      }
      await page.hover('.changes-review-trigger');
      assert.deepEqual(await readCounts(), idle, `${appearance}: trigger hover preserves count colors`);
      await page.hover('.changes-review-header');
      assert.deepEqual(await readCounts(), idle, `${appearance}: menu hover preserves count colors`);
      const readMenuState = (selector: string) => page.$eval(selector, element => {
        const style = getComputedStyle(element);
        return {
          color: style.color, background: style.backgroundColor, radius: style.borderRadius,
          outline: style.outline, outlineOffset: style.outlineOffset, height: style.height
        };
      });
      const selectedState = await readMenuState('.changes-review-snapshot-select.is-selected');
      assert.equal((await readMenuState('[data-toggle="before-content"]')).background, 'rgba(0, 0, 0, 0)', `${appearance}: enabled Changes switch has no persistent row background`);
      const hoverStates = [];
      for (const selector of ['[data-baseline="git-head"]', '.changes-review-snapshot-select', '.changes-review-snapshot-action', '[data-toggle="before-content"]']) {
        await page.hover(selector);
        hoverStates.push({ selector, state: await readMenuState(selector), selected: await page.$eval(selector, element =>
          element.getAttribute('role') === 'menuitemradio' && element.getAttribute('aria-checked') === 'true') });
      }
      await page.click('.changes-review-trigger');
      await page.click('.more-tools-wrapper > button');
      await page.hover('.more-tools-section-label');
      const switches = await page.$$eval('.more-tools-option[role="menuitemcheckbox"]', elements => elements.map(element => getComputedStyle(element).backgroundColor));
      assert.ok(switches.length > 0 && switches.every(color => color === 'rgba(0, 0, 0, 0)'), `${appearance}: Settings switches have no persistent row backgrounds`);
      await page.hover('.more-tools-option[data-action="sourceLineNumbers"]');
      const enabledSwitchHover = await readMenuState('.more-tools-option[data-action="sourceLineNumbers"]');
      await page.hover('.more-tools-option[data-action="liveStrongColoring"]');
      const settingsHover = await readMenuState('.more-tools-option[data-action="liveStrongColoring"]');
      assert.deepEqual(enabledSwitchHover, settingsHover, `${appearance}: on/off switches share the same hover style`);
      assert.notEqual(selectedState.background, settingsHover.background, `${appearance}: radio selection and hover states are distinct`);
      assert.ok(contrast(selectedState.background, idle.backgrounds[1]!) > contrast(settingsHover.background, idle.backgrounds[1]!), `${appearance}: selected radio background is stronger than hover`);
      for (const { selector, state, selected } of hoverStates) {
        assert.deepEqual(state, selected ? selectedState : settingsHover, `${appearance}: ${selector} preserves its radio-selection/hover state`);
      }
      const headings = await page.$$eval('.more-tools-panel .more-tools-section-label, .changes-review-panel .changes-review-section-label', elements => elements.map(element => getComputedStyle(element).color));
      assert.equal(headings.length, 5, 'Both menus expose all five group headings');
      assert.equal(new Set(headings).size, 1, 'Both menus share the same weaker heading color');
      for (const color of headings) {
        assert.ok(contrast(color, idle.backgrounds[1]!) < contrast(settingsHover.color, idle.backgrounds[1]!), `${appearance}: group headings are weaker than ordinary options`);
        const background = channels(idle.backgrounds[1]!);
        const distance = (value: string) => channels(value).reduce((sum, channel, index) => sum + Math.abs(channel - background[index]!), 0);
        assert.ok(distance(color) / distance(settingsHover.color) <= 0.65, `${appearance}: group headings are another step weaker`);
        assert.ok(contrast(color, idle.backgrounds[1]!) >= 3, `${appearance}: group headings remain distinguishable`);
      }
      await page.click('.more-tools-wrapper > button');
    }
    console.log('changes review consistency checks passed');
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
