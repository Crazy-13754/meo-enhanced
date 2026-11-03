import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'puppeteer-core';

const markdown = [
  '# 格式检查 Format check',
  '## 文字 Text',
  '- 普通文字 plain text',
  '- **粗体 bold**、*斜体 italic*、~~删除线 deleted~~',
  '- ==高亮 Highlight==、++插入 Inserted++、H~2~O、x^2^',
  '- `const x = 1` 与普通文字',
  '- [链接文字 Link](https://example.invalid) 与 [[Note|链接别名 Alias]]',
  '- ![图片替代文字 Image alt](https://example.invalid/image.png)',
  '## 标题 Headings', '### H3', '#### H4', '##### H5', '###### H6',
  '普通段落 Paragraph outside a list.',
  '## 结构 Structure',
  '- 父项 Parent',
  '  - 子项 Child',
  '- [ ] 未完成 Pending',
  '- [x] 已完成 Done',
  '1. 有序条目 Ordered',
  '2. 第二项 Second',
  '',
  '> 引用 Quote',
  '>\n> - 引用内列表 Quoted list',
  '',
  '## 表格 Table',
  '| Left | Center | Right |',
  '| :--- | :---: | ---: |',
  '| `const x = 1` | **bold** | *italic* |',
  '| example | ~~old value~~ | $x^2$ |',
  '| `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789` | 中文 | last |',
  '',
  '## 代码 Code',
  '```ts',
  'const longLine = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";',
  '  // 保留缩进 indentation',
  '```',
  '## 公式 Math',
  '- 行内 $x^2 + \\frac{1}{2}$',
  '',
  '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$',
  '',
  '## 长文字 Wrap',
  '- ' + '长中文换行 '.repeat(15),
  '- https://example.invalid/' + 'long-path-without-spaces'.repeat(8),
  '## 作者配色 Authored <!-- color: white; bgColor: #703060 -->',
  '- 保留指定颜色',
].join('\n');

/** Real host + companion: rendered geometry and readable content, not CSS source assertions. */
export async function checkDocumentViewContent(page: Page, out: string) {
  await page.setViewport({ width: 1600, height: 1200 });
  await page.evaluate(text => window.dispatchEvent(new MessageEvent('message', { data: { type: 'docChanged', version: 1000, text } })), markdown);
  await page.click('.mm-view-entry');
  await page.waitForFunction(() => document.querySelector('.meo-markmap')?.textContent?.includes('长文字 Wrap') && !document.querySelector('.meo-map-status')?.textContent);
  await page.click('[data-view-action="fit"]');
  await page.$eval('g.markmap-node[aria-label="作者配色 Authored"] circle', e => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const failures: string[] = [];
  for (const appearance of ['light', 'dark']) {
    if (!await page.$('.mm-view-panel.is-side')) await page.click('[data-view-action="layout"]');
    // The actual settings entry updates the document palette and shared host roles.
    await page.click('[data-action="settings"]');
    await page.click(`[data-editor-appearance="${appearance}"]`);
    await page.click('[data-action="settings"]');
    await page.click('[data-view-action="layout"]');
    await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
    await page.$eval('g.markmap-node[aria-label="文字 Text"]', e => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForSelector('.markmap-highlight rect');
    for (const family of ['Arial', 'Consolas', 'Microsoft YaHei']) {
      const before = await page.$eval('.meo-markmap', e => ({ camera: e.querySelector(':scope > g')!.getAttribute('transform'), folds: e.querySelectorAll('.markmap-fold').length }));
      await page.evaluate(family => {
        const style = document.documentElement.style;
        style.setProperty('--meo-font-live', `"${family}"`);
        style.setProperty('--meo-font-source', `"${family}"`);
        style.setProperty('--meo-user-editor-font-size', '18px');
      }, family);
      // Markmap's own ResizeObserver remeasures text and relays out links after font changes.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
      assert.deepEqual(await page.$eval('.meo-markmap', e => ({ camera: e.querySelector(':scope > g')!.getAttribute('transform'), folds: e.querySelectorAll('.markmap-fold').length })), before, 'Font changes retain pan, zoom and folds');
      assert(await page.$('.markmap-highlight rect'), 'Font changes retain selection');
      await page.click('[data-view-action="fit"]');
      const result = await page.evaluate(() => {
        const svg = document.querySelector<SVGSVGElement>('.meo-markmap')!;
        const scale = (svg as any).__zoom.k as number;
        const problems: string[] = [];
        const inside = (inner: DOMRect, outer: DOMRect) => inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5 && inner.left >= outer.left - .5 && inner.right <= outer.right + .5;
        for (const code of svg.querySelectorAll('td code, th code')) {
          if (!inside(code.getBoundingClientRect(), code.closest('td,th')!.getBoundingClientRect())) problems.push('table code overlaps a cell boundary');
        }
        for (const foreign of svg.querySelectorAll('foreignObject')) {
          for (const content of foreign.querySelectorAll('pre,table,math,code')) {
            if (!inside(content.getBoundingClientRect(), foreign.getBoundingClientRect())) {
              const c = content.getBoundingClientRect(), f = foreign.getBoundingClientRect();
              const label = foreign.querySelector('div > div') as HTMLElement;
              problems.push(`${content.tagName} exceeds its measured node: ${[c.top-f.top,c.bottom-f.bottom,c.left-f.left,c.right-f.right].map(v=>v.toFixed(2))} measured=${foreign.getAttribute('width')}x${foreign.getAttribute('height')} now=${label.scrollWidth}x${label.scrollHeight}`);
            }
          }
          if (foreign.getBoundingClientRect().width / scale > 282) problems.push('long content exceeds the configured 280px node width');
        }
        const table = svg.querySelector('table')!;
        const headings = [...table.querySelectorAll('th')].map(e => getComputedStyle(e).textAlign);
        if (headings.join(',') !== 'left,center,right') problems.push(`table alignment lost: ${headings}`);
        const family = getComputedStyle(svg).fontFamily;
        const fontSize = getComputedStyle(svg).fontSize;
        const strong = getComputedStyle(svg.querySelector('strong')!);
        const em = getComputedStyle(svg.querySelector('em')!);
        const del = getComputedStyle(svg.querySelector('del,s')!);
        if (Number(strong.fontWeight) < 600 || em.fontStyle !== 'italic' || !del.textDecorationLine.includes('line-through')) problems.push('inline emphasis lost');
        const text = [...svg.querySelectorAll('.markmap-foreign')].map(e => e.textContent).join('\n');
        for (const sample of ['☐ 未完成', '☑ 已完成', '链接文字 Link', '链接别名 Alias', '图片替代文字 Image alt', '引用 Quote', 'Quoted list', '有序条目 Ordered', '子项 Child', '  // 保留缩进', 'H3', 'H4', 'H5', 'H6', 'Paragraph outside a list']) {
          if (!text.includes(sample)) problems.push(`content lost: ${sample}`);
        }
        if (svg.querySelectorAll('math').length < 3) problems.push('formula missing');
        if (!svg.querySelector('mark') || !svg.querySelector('ins') || !svg.querySelector('sub') || !svg.querySelector('sup')) problems.push('extended inline formatting missing');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        const background = getComputedStyle(document.querySelector('.mm-view-panel')!).backgroundColor;
        const luminance = (color: string, base = background) => {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = base; ctx.fillRect(0, 0, 1, 1);
          ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
        };
        for (const selector of ['code', 'mark', 'blockquote', 'th', 'math']) {
          const style = getComputedStyle(svg.querySelector(selector)!);
          const ink = luminance(style.color), paper = luminance(style.backgroundColor);
          if ((Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05) < 4.5) problems.push(`${selector} text lacks contrast`);
        }
        if (svg.querySelector('a,img,script')) problems.push('display-only content became interactive');
        const authored = [...svg.querySelectorAll('.markmap-foreign > div > div')].find(e => e.textContent?.includes('作者配色 Authored'))!;
        if (!authored || getComputedStyle(authored).color !== 'rgb(255, 255, 255)' || getComputedStyle(authored).backgroundColor !== 'rgb(112, 48, 96)') problems.push('author color changed');
        return { problems, family, fontSize };
      });
      if (!result.family.includes(family) || result.fontSize !== '18px') result.problems.push(`document typography not inherited: ${result.family} ${result.fontSize}`);
      failures.push(...result.problems.map(problem => `${appearance}/${family}: ${problem}`));
      await page.screenshot({ path: path.join(out, `content-${appearance}-${family.replaceAll(' ', '-')}.png`) });
    }
  }
  assert.deepEqual(failures, [], 'Content must retain formatting and fit its measured node in both themes');
}
