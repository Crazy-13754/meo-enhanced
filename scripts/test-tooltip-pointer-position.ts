import assert from 'node:assert/strict';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-tooltip-display-latency-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const script = await build.outputs[0]!.text();
const browser = await launchTestBrowser();

try {
  for (const nested of [false, true]) for (const theme of ['light', 'dark']) for (const language of ['en', 'zh-CN']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 720, height: 540 });
    await page.setContent(nested ? '<!doctype html><iframe style="position:absolute;left:70px;top:45px;width:620px;height:480px;border:0"></iframe>' : '<!doctype html>');
    const surface = nested ? page.frames()[1]! : page;
    await surface.setContent(`<!doctype html><style>
      html,body{margin:0;min-height:1200px}button{position:absolute;border:0;padding:0;background:#ddd}
      #wide{left:24px;top:60px;width:592px;height:48px}#tall{left:24px;top:144px;width:28px;height:240px}
      #direct{left:350px;top:440px;width:100px;height:28px}
    </style><button id="wide" data-tooltip-positioning="pointer"><span>Wide target</span></button>
    <button id="tall" data-tooltip-positioning="pointer">Tall target</button><button id="direct">Direct target</button>`);
    await page.evaluate(({ theme, language }) => {
      document.documentElement.dataset.editorAppearance = theme;
      document.documentElement.lang = language;
    }, { theme, language });
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await surface.evaluate(language => {
      document.getElementById('wide')!.dataset.tooltip = language === 'en' ? 'Click to return to table header' : '点击回到表头';
      document.getElementById('tall')!.dataset.tooltip = language === 'en' ? 'Click to reveal in source' : '点击定位源码';
    }, language);
    await page.addScriptTag({ content: script });
    await page.evaluate(() => { (window as any).__binding = (window as any).TooltipLatencyHarness.bindTooltips(document.body); });
    if (nested) await surface.waitForSelector('[data-meo-tooltip-style]');
    const move = async (x: number, y: number) => {
      const offset = nested ? { x: 70, y: 45 } : { x: 0, y: 0 };
      await page.mouse.move(x + offset.x, y + offset.y);
      await surface.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    };
    const hint = () => surface.$eval('.meo-tooltip.is-visible', element => {
      const rect = element.getBoundingClientRect();
      return { id: element.id, text: element.textContent, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        side: (element as HTMLElement).dataset.side, inside: rect.left >= 8 && rect.top >= 8 && rect.right <= innerWidth - 8 && rect.bottom <= innerHeight - 8,
        pointerEvents: getComputedStyle(element).pointerEvents, background: getComputedStyle(element).backgroundColor };
    });
    await move(100, 80);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    const initial = await hint();
    assert.equal(initial.text, language === 'en' ? 'Click to return to table header' : '点击回到表头');
    assert.equal(initial.left, 112); assert.equal(initial.top, 88);
    assert.equal(initial.side, 'right'); assert.equal(initial.pointerEvents, 'none');
    assert.equal(initial.background, theme === 'dark' ? 'rgb(58, 58, 58)' : 'rgb(13, 13, 13)');
    await move(200, 86);
    const moved = await hint();
    assert.equal(moved.id, initial.id, 'movement retains the same visible hint');
    assert.equal(moved.left - initial.left, 100); assert.equal(moved.top - initial.top, 6);
    await page.keyboard.press('Escape');
    await move(210, 86);
    assert.equal(await surface.$('.meo-tooltip.is-visible'), null, 'movement cannot undo Escape dismissal');
    await move(0, 0);
    await surface.$eval('#wide', element => {
      element.classList.add('meo-md-html-table-sticky-header');
      const resize = document.createElement('span'); resize.className = 'meo-md-html-table-column-resize-handle';
      resize.style.cssText = 'position:absolute;left:300px;top:0;width:10px;height:48px;pointer-events:auto';
      element.append(resize);
    });
    await move(329, 80);
    assert.equal(await surface.$('.meo-tooltip.is-visible, .meo-tooltip.is-pending'), null, 'column resizing does not expose a table navigation hint');
    await surface.$eval('#wide', element => { element.classList.remove('meo-md-html-table-sticky-header'); element.lastElementChild!.remove(); });

    await move(38, 210);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    const tall = await hint();
    await move(38, 320);
    assert.equal((await hint()).top - tall.top, 110, 'a tall navigation surface follows the hovered position');
    await surface.evaluate(() => scrollTo(0, 200));
    await surface.waitForFunction(() => !document.querySelector('.meo-tooltip.is-visible'));
    assert.equal(await surface.$('.meo-tooltip.is-visible'), null, 'scrolling away closes the hint even while part of the target is still visible');
    await surface.evaluate(() => scrollTo(0, 0));
    await move(0, 0);
    const width = await surface.evaluate(() => innerWidth);
    await surface.$eval('#wide', (element, width) => { (element as HTMLElement).style.left = width - 592 + 'px'; }, width);
    await move(width - 20, 80);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    const edge = await hint();
    assert.equal(edge.side, 'left'); assert.equal(edge.inside, true, 'edge placement remains inside its own frame');
    await page.mouse.down(); await page.mouse.up();
    assert.equal(await surface.$('.meo-tooltip.is-visible'), null, 'click closes the hint');
    await move(0, 0);

    const height = await surface.evaluate(() => innerHeight);
    await surface.$eval('#tall', (element, height) => { (element as HTMLElement).style.top = height - 80 + 'px'; (element as HTMLElement).style.height = '60px'; }, height);
    await move(38, height - 24);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    assert.equal((await hint()).inside, true, 'bottom edges shift vertically');
    await move(0, 0);
    await surface.$eval('#tall', element => { (element as HTMLElement).style.top = ''; (element as HTMLElement).style.height = ''; });
    await page.keyboard.press('Tab');
    await surface.focus('#tall');
    await surface.waitForSelector('.meo-tooltip.is-visible');
    const keyboard = await hint();
    const targetTop = await surface.$eval('#tall', element => element.getBoundingClientRect().top);
    assert.ok(keyboard.bottom <= targetTop, 'keyboard focus uses the component instead of a stale pointer');
    await page.keyboard.press('Escape');
    await surface.$eval('#tall', element => (element as HTMLElement).blur());

    await move(38, 210);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    await surface.evaluate(() => {
      const menu = document.createElement('div'); menu.id = 'obstacle'; menu.setAttribute('role', 'menu');
      menu.style.cssText = 'position:fixed;left:52px;top:190px;width:200px;height:110px;background:white;z-index:100'; document.body.append(menu);
    });
    await surface.waitForFunction(() => !document.querySelector('.meo-tooltip.is-visible'));
    await surface.$eval('#obstacle', element => element.remove());
    await move(0, 0);

    // The component API and metadata binder share positioning, including precedence.
    await surface.evaluate(() => {
      const element = document.getElementById('direct')!; element.dataset.tooltipPositioning = 'pointer';
      (window as any).__direct = (window.top as any).TooltipLatencyHarness.createTooltip(element, { content: { text: 'Direct hint' }, positioning: 'element' });
    });
    await move(380, 450);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    assert.ok((await hint()).bottom <= 440, 'explicit element positioning overrides pointer metadata');
    await move(0, 0);
    await surface.evaluate(() => {
      (window as any).__direct.dispose();
      const element = document.getElementById('direct')!; element.dataset.tooltipPositioning = 'element';
      (window as any).__direct = (window.top as any).TooltipLatencyHarness.createTooltip(element, { content: { text: 'Direct hint' }, positioning: 'pointer', placement: 'left' });
    });
    await move(380, 450);
    await surface.waitForSelector('.meo-tooltip.is-visible');
    const direct = await hint();
    assert.equal(direct.side, 'left'); assert.equal(direct.right, 368, 'explicit pointer positioning and direction override metadata');
    await move(390, 450);
    assert.equal((await hint()).right, 378, 'direct components also follow pointer movement');
    await surface.evaluate(() => (window as any).__direct.dispose());
    assert.equal(await surface.$('.meo-tooltip.is-visible'), null, 'disposal removes the active hint');

    // Full-text hints belong outside the whole list, including its other columns.
    await move(0, 0);
    await surface.evaluate(language => {
      for (const element of document.querySelectorAll<HTMLElement>('button')) element.hidden = true;
      const list = document.createElement('div'); list.id = 'fulltext-list';
      list.style.cssText = 'position:fixed;display:block;left:16px;top:160px;width:230px;height:100px;box-sizing:border-box;padding:12px;overflow:hidden';
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;height:32px';
      const texts = language === 'en'
        ? ['A long heading with enough detail to identify the document', 'notes/reference/a-long-document-name.md#installation-details']
        : ['包含完整说明以便识别文档的较长目录标题', '文档/参考资料/较长的文档名称.md#安装与使用说明'];
      for (const [index, text] of texts.entries()) {
        const target = document.createElement(index === 0 ? 'button' : 'span'); target.id = index === 0 ? 'list-label' : 'list-detail';
        target.style.cssText = 'position:static;display:block;flex:0 0 100px;width:100px;height:28px;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        target.textContent = text; target.dataset.tooltip = text; target.dataset.tooltipKind = 'fulltext'; row.append(target);
      }
      const short = document.createElement('span'); short.id = 'list-short'; short.textContent = 'Short';
      short.style.cssText = 'display:block;width:200px;height:28px'; short.dataset.tooltip = 'Short'; short.dataset.tooltipKind = 'fulltext';
      list.append(row, short); document.body.append(list);
    }, language);
    const hoverList = async (selector: string) => {
      await move(0, 0);
      const rect = await surface.$eval(selector, element => {
        const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await move(rect.x, rect.y);
      await surface.waitForSelector('.meo-tooltip.is-visible');
      return { hint: await hint(), center: rect.y };
    };
    for (const kind of ['outline-sidebar', 'meo-input-suggestions']) for (const side of ['right', 'left']) {
      await move(0, 0);
      await surface.$eval('#fulltext-list', (element, { kind, side, width }) => {
        element.className = kind;
        (element as HTMLElement).style.left = (side === 'right' ? 16 : width - 246) + 'px';
        element.querySelector('#list-label')!.className = kind === 'outline-sidebar' ? 'outline-item' : 'meo-suggestion-label';
        element.querySelector('#list-detail')!.className = 'meo-input-suggestion-detail';
      }, { kind, side, width });
      for (const selector of kind === 'outline-sidebar' ? ['#list-label'] : ['#list-label', '#list-detail']) {
        const { hint: result, center } = await hoverList(selector);
        const list = await surface.$eval('#fulltext-list', element => {
          const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right };
        });
        assert.equal(result.text, await surface.$eval(selector, element => element.textContent));
        assert.equal(result.side, side, `${kind} uses its available horizontal side`);
        assert.equal(side === 'right' ? result.left - list.right : list.left - result.right, 6, 'full text clears the entire list');
        assert.ok(Math.abs((result.top + result.bottom) / 2 - center) < 1, 'full text aligns with the hovered row');
        assert.equal(result.inside, true); assert.equal(result.pointerEvents, 'none');
      }
    }
    await move(0, 0);
    await surface.$eval('#list-label', element => (element as HTMLElement).dataset.tooltipPlacement = 'top');
    assert.equal((await hoverList('#list-label')).hint.side, 'top', 'explicit directions override the list default');
    await move(0, 0);
    await surface.$eval('#list-label', element => delete (element as HTMLElement).dataset.tooltipPlacement);
    await surface.$eval('#fulltext-list', element => { (element as HTMLElement).style.left = '8px'; (element as HTMLElement).style.width = innerWidth - 16 + 'px'; });
    const fallback = (await hoverList('#list-label')).hint;
    assert.equal(fallback.side, 'top', 'a list filling the viewport retains a visible fallback');
    assert.equal(fallback.inside, true);
    await move(0, 0);
    const short = await surface.$eval('#list-short', element => {
      const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await move(short.x, short.y);
    await surface.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
    assert.equal(await surface.$('.meo-tooltip.is-visible, .meo-tooltip.is-pending'), null, 'fitting list text does not show a full-text hint');
    console.log(`Tooltip positioning: ${theme}, ${language}, iframe=${nested}: pointer, edges, keyboard, menus, component API and list full text passed`);
    await page.close();
  }
} finally {
  await closeTestBrowser(browser);
}
