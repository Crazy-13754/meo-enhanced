import assert from 'node:assert/strict';
import fs from 'node:fs';
import { outlineHeadingKeys } from '../src/foundation/outline';
import type { SidebarOutlineMessage } from '../src/protocol/sidebarOutline';
import { browser, server, open, frames } from './input-presentation-test-helpers';
import { closeTestBrowser } from './browser-test-helpers';

let failure: unknown;
let failed = false;
try {
  for (const count of [8, 1_300]) {
    const text = '# Outline integration\n\n' + Array.from({ length: count }, (_, index) =>
      `## Section ${index}\n\n${'Readable paragraph with **formatting** and `code`. '.repeat(count > 10 ? 16 : 2)}\n\n`
      + '```markdown\n# Not a heading\n```\n\n').join('');
    for (const mode of ['live', 'source', 'preview'] as const) {
      if (process.env.MEO_OUTLINE_TEST_MODE && process.env.MEO_OUTLINE_TEST_MODE !== mode) continue;
      const page = await browser.newPage();
      const host = await open(page, text, false, mode);
      let stage = 'initial outline';
      try {
        await page.evaluate(() => {
          const scope = window as any;
          scope.__sidebarMessages = [];
          const original = scope.__presentationHost;
          scope.__presentationHost = (message: any) => {
            if (message.type === 'sidebarOutline') scope.__sidebarMessages.push(message);
            return original(message);
          };
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'sidebarOutlineSubscription', enabled: true } }));
        });
        await page.waitForFunction(count => (window as any).__sidebarMessages.some((message: any) =>
          message.headings?.length === count + 1), { timeout: 15_000 }, count);
        const full = await page.evaluate(() => (window as any).__sidebarMessages.find((message: any) => message.headings)) as SidebarOutlineMessage;
        assert.equal(full.headings![0].text, 'Outline integration');
        assert.ok(full.headings!.every(heading => heading.text !== 'Not a heading'));
        if (count > 10 && mode !== 'preview') assert.equal(host.renders.length, 0,
          'large sidebar outlines do not initialize hidden Preview');

        stage = 'scroll viewport';
        await page.evaluate(mode => {
          const scroller = mode === 'preview'
            ? document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument?.scrollingElement
            : document.querySelector('.editor-host .cm-scroller');
          if (!scroller) throw new Error('Missing production scroll surface');
          scroller.scrollTop = scroller.scrollHeight * 0.65;
        }, mode);
        await page.waitForFunction(() => (window as any).__sidebarMessages.some((message: any) =>
          !message.headings && message.activeIndex > 0 && message.visibleIndexes?.length));
        assert.equal(await page.evaluate(() => (window as any).__sidebarMessages.filter((message: any) => message.headings).length), 1,
          'scrolling sends viewport metadata without resending the heading tree');

        stage = 'navigation after editing';
        const target = Math.min(4, full.headings!.length - 1);
        const key = outlineHeadingKeys(full.headings!)[target];
        const prefix = 'Inserted before the outline.\n\n'.repeat(10);
        await host.replaceHostText(prefix + text);
        await page.evaluate(({ key, snapshot }) => window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'revealOutlineHeading', key, snapshot }
        })), { key, snapshot: full.snapshot });
        await page.waitForFunction(label => {
          const root = document.querySelector<HTMLIFrameElement>('.preview-frame')?.contentDocument;
          const candidates = document.querySelector('.editor-root')?.getAttribute('data-mode') === 'preview'
            ? [...(root?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])]
            : [...document.querySelectorAll('.editor-host .cm-line')];
          const surfaceTop = document.querySelector('.editor-root')?.getAttribute('data-mode') === 'preview'
            ? 0 : document.querySelector('.editor-host .cm-scroller')!.getBoundingClientRect().top;
          return candidates.some(element => {
            const top = element.getBoundingClientRect().top - surfaceTop;
            // Native scrollTop rounds fractional heading geometry to device pixels.
            return element.textContent?.includes(label) && top >= -1 && top < 32;
          });
        }, {}, full.headings![target].text);

        stage = 'hide and resume';
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'sidebarOutlineSubscription', enabled: false }
        })));
        const before = await page.evaluate(() => (window as any).__sidebarMessages.length);
        await host.replaceHostText(prefix + text + '\n## Hidden update\n');
        await frames(page, 12);
        assert.equal(await page.evaluate(() => (window as any).__sidebarMessages.length), before,
          'hidden outline does no publishing during document edits');
        await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'sidebarOutlineSubscription', enabled: true }
        })));
        await page.waitForFunction(count => (window as any).__sidebarMessages.some((message: any) =>
          message.headings?.length === count + 2), {}, count);
        assert.deepEqual(host.errors, []);
        console.log(`Sidebar outline production ${mode}, ${count} sections: cold load, scroll, navigation, hide and resume passed`);
      } catch (error) {
        fs.mkdirSync('tmp', { recursive: true });
        await page.screenshot({ path: `tmp/sidebar-outline-${mode}-${count}-failure.png` });
        const state = await page.evaluate(() => ({
          mode: document.querySelector('.editor-root')?.getAttribute('data-mode'),
          messages: (window as any).__sidebarMessages?.slice(-4).map((message: any) => ({
            headings: message.headings?.length, activeIndex: message.activeIndex, visibleIndexes: message.visibleIndexes
          })),
          previewFrames: [...document.querySelectorAll<HTMLIFrameElement>('.preview-frame')].map(frame => ({
            hidden: frame.hidden, bounds: { top: frame.getBoundingClientRect().top, height: frame.getBoundingClientRect().height },
            scroll: frame.contentDocument?.scrollingElement?.scrollTop,
            headings: [...(frame.contentDocument?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].slice(0, 9).map(heading => ({
              text: heading.textContent, top: heading.getBoundingClientRect().top
            }))
          }))
        }));
        throw new Error(`Sidebar ${mode}/${count}, ${stage}: ${JSON.stringify(state)}`, { cause: error });
      } finally { host.dispose(); await page.close(); }
    }
  }
} catch (error) { failure = error; failed = true; }
finally {
  server.stop(true);
  if (failed) await closeTestBrowser(browser, failure);
  else await closeTestBrowser(browser);
}
if (failed) throw failure;
