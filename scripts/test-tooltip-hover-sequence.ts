import assert from 'node:assert/strict';
import { closeTestBrowser, launchTestBrowser } from './browser-test-helpers';

const build = await Bun.build({ entrypoints: ['scripts/test-tooltip-display-latency-entry.ts'], target: 'browser', format: 'iife' });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const script = await build.outputs[0]!.text();
const fixture = '<!doctype html><style>html,body{margin:0}button{position:absolute;top:80px;width:70px;height:30px}#a{left:40px}#b{left:150px}#c{left:260px}</style><button id="a" data-tooltip="Action A">A</button><button id="b" data-tooltip="Action B">B</button><button id="c" data-tooltip="Action C">C</button>';
const browser = await launchTestBrowser();

try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 480 });
    await page.setContent(fixture + '<style>#fade{position:absolute;left:370px;top:80px;width:70px;height:30px;opacity:0;transition:opacity .15s}#fade:hover{opacity:1}#fade button{left:0;top:0}</style><div id="fade"><button data-tooltip="Fade action">Fade</button></div><iframe style="position:absolute;left:0;top:200px;width:500px;height:220px;border:0"></iframe>');
    const frame = page.frames()[1]!;
    await frame.setContent(fixture);
    await page.evaluate(theme => { document.documentElement.dataset.editorAppearance = theme; }, theme);
    await page.addStyleTag({ path: 'webview/src/styles.css' });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => { (window as any).__binding = (window as any).TooltipLatencyHarness.bindTooltips(document.body); });
    await frame.waitForSelector('[data-meo-tooltip-style]');

    // Native pointer input exercises departure/entry ordering, including frame crossings.
    await page.mouse.move(75, 95);
    await page.waitForSelector('.meo-tooltip.is-visible');
    await page.mouse.move(185, 95);
    assert.equal(await page.$eval('#b', element => getComputedStyle(document.getElementById(element.getAttribute('aria-describedby')!)!).opacity), '1', 'another button shows without a new delay');
    await page.mouse.move(75, 295);
    assert.equal(await frame.$eval('#a', element => getComputedStyle(document.getElementById(element.getAttribute('aria-describedby')!)!).opacity), '1', 'Preview shares the same hover sequence');
    assert.equal(await page.$('.meo-tooltip.is-visible'), null, 'frame crossing still shows only one hint');
    await page.mouse.move(600, 450);
    await page.keyboard.press('Escape');
    await page.hover('#a');
    await page.waitForSelector('.meo-tooltip.is-visible');
    await page.hover('#fade button');
    assert.equal(await page.$eval('#fade button', element => {
      const hint = document.getElementById(element.getAttribute('aria-describedby') ?? '');
      return hint ? getComputedStyle(hint).opacity : 'missing';
    }), '1', 'hover fade-in controls keep an immediate hint at the transition start');
    await page.mouse.move(600, 450);
    await page.keyboard.press('Escape');
    await page.$eval('#fade', element => { (element as HTMLElement).style.cssText = 'opacity:0;transition:none'; });
    await page.hover('#fade button');
    await new Promise(resolve => setTimeout(resolve, 240));
    assert.equal(await page.$('.meo-tooltip.is-visible'), null, 'a persistently transparent control still has no hint');
    await page.mouse.move(600, 450);
    await page.keyboard.press('Escape');
    await page.$eval('#fade', element => element.remove());

    for (const scenario of ['cold-sweep', 'renewed-window', 'expired', 'empty-target', 'click', 'gap-click', 'escape', 'gap-escape', 'blur', 'gap-blur', 'remove', 'stateful-click', 'keyboard', 'frame-expired', 'frame-warm', 'direct', 'gap-dispose'] as const) {
      const observations = await page.evaluate(async scenario => {
        const child = document.querySelector('iframe')!.contentDocument!;
        const a = document.getElementById('a')!, b = document.getElementById('b')!, c = document.getElementById('c')!;
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const enter = (element: HTMLElement) => {
          const view = element.ownerDocument.defaultView!, rect = element.getBoundingClientRect();
          element.dispatchEvent(new view.PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: rect.left + 35, clientY: rect.top + 15 }));
          element.dispatchEvent(new view.MouseEvent('mouseenter', { clientX: rect.left + 35, clientY: rect.top + 15 }));
        };
        const leave = (element: HTMLElement) => {
          const doc = element.ownerDocument, view = doc.defaultView!;
          element.dispatchEvent(new view.MouseEvent('mouseleave'));
          doc.body.dispatchEvent(new view.PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: 10, clientY: 10 }));
        };
        const opacity = (element: HTMLElement) => {
          const doc = element.ownerDocument, hint = doc.getElementById(element.getAttribute('aria-describedby') ?? '');
          return hint ? doc.defaultView!.getComputedStyle(hint).opacity : 'missing';
        };
        const key = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        key('Escape');
        for (const doc of [document, child]) doc.body.dispatchEvent(new doc.defaultView!.PointerEvent('pointerover', { bubbles: true }));
        a.removeAttribute('data-tooltip-live-update'); a.dataset.tooltip = 'Action A';
        (document.activeElement as HTMLElement)?.blur();
        if (scenario === 'gap-dispose') {
          // Remove the frame first so its independent teardown cannot mask the root reset.
          document.querySelector('iframe')!.remove(); await wait(0);
        }
        enter(a);
        const cold = opacity(a);
        if (scenario === 'cold-sweep') {
          leave(a); enter(b);
          const next = opacity(b); await wait(240);
          return { cold, next, eventual: opacity(b) };
        }
        await wait(240);
        const shown = opacity(a);
        if (scenario === 'renewed-window') {
          await wait(560); leave(a); await wait(300); enter(b);
          const next = opacity(b); leave(b); await wait(350); enter(c);
          return { cold, shown, next, last: opacity(c) };
        }
        if (scenario === 'expired' || scenario === 'frame-expired' || scenario === 'frame-warm') {
          leave(a); await wait(scenario === 'frame-warm' ? 350 : 550);
          const target = scenario === 'expired' ? b : child.getElementById('b')!;
          enter(target); const next = opacity(target);
          if (scenario === 'frame-warm') return { cold, shown, next };
          await wait(240);
          return { cold, shown, next, eventual: opacity(target) };
        }
        if (scenario === 'empty-target') {
          leave(a); await wait(300); document.body.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          await wait(300); enter(b); const next = opacity(b); await wait(240);
          return { cold, shown, next, eventual: opacity(b) };
        }
        if (scenario === 'direct') {
          leave(a);
          const element = document.createElement('button'); element.style.cssText = 'left:370px;top:80px'; document.body.append(element);
          const direct = (window as any).TooltipLatencyHarness.createTooltip(element, { content: { text: 'Direct action' } });
          enter(element); const next = opacity(element); direct.dispose(); element.remove();
          return { cold, shown, next };
        }
        if (scenario.startsWith('gap-')) leave(a);
        if (scenario === 'click' || scenario === 'gap-click' || scenario === 'stateful-click') {
          if (scenario === 'stateful-click') a.dataset.tooltipLiveUpdate = 'true';
          (scenario === 'gap-click' ? document.body : a).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        }
        if (scenario === 'escape' || scenario === 'gap-escape') key('Escape');
        if (scenario === 'blur' || scenario === 'gap-blur') window.dispatchEvent(new Event('blur'));
        if (scenario === 'gap-dispose') {
          (window as any).__binding.dispose();
          (window as any).__binding = (window as any).TooltipLatencyHarness.bindTooltips(document.body);
        }
        if (scenario === 'remove') {
          a.remove(); await Promise.resolve();
        }
        let retained: string | undefined;
        if (scenario === 'stateful-click') {
          a.dataset.tooltip = 'Next action'; await Promise.resolve(); retained = opacity(a);
        }
        if (!scenario.startsWith('gap-') && scenario !== 'remove') leave(a);
        if (scenario === 'keyboard') { key('Tab'); b.focus(); }
        else enter(b);
        const next = opacity(b); await wait(240);
        if (scenario === 'remove') { document.body.prepend(a); }
        return { cold, shown, next, eventual: opacity(b), ...(retained ? { retained } : {}) };
      }, scenario);
      assert.equal(observations.cold, '0', `${theme}/${scenario}: first hover waits`);
      if ('shown' in observations) assert.equal(observations.shown, '1', `${theme}/${scenario}: first hint must have shown`);
      const immediate = scenario === 'renewed-window' || scenario === 'frame-warm' || scenario === 'direct';
      assert.equal(observations.next, immediate ? '1' : '0', `${theme}/${scenario}: correct continuation or reset`);
      if ('eventual' in observations) assert.equal(observations.eventual, '1', `${theme}/${scenario}: delayed hints still reveal`);
      if ('last' in observations) assert.equal(observations.last, '1', 'each shown hover renews the departure window');
      if ('retained' in observations) assert.equal(observations.retained, '1', 'stateful clicks retain their current hint while resetting continuation');
    }
    await page.close();
    console.log(`Tooltip hover sequence: ${theme}: native button/frame handoff, fade-in controls, cold sweep, departure deadline, resets, teardown, keyboard and direct component passed`);
  }
} finally {
  await closeTestBrowser(browser);
}
