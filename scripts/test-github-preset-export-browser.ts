import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import exportRuntime from '../src/export/runtime';
import { launchTestBrowser } from './browser-test-helpers';

const fixture = path.resolve('scripts/fixtures/github-readme/README.md');
const text = readFileSync(fixture, 'utf8');
mkdirSync('tmp/github-export', { recursive: true });
const base = {
  readingSnapshot: {
    snapshotId: 'github-export', text, appearance: 'light' as 'light' | 'dark', uiLanguage: 'en' as const,
    preset: 'github-readme' as const,
    environment: { previewFontFamily: 'Georgia', previewSourceColoring: false, previewShowComments: true }
  },
  sourceDocumentPath: fixture,
  outputFilePath: path.resolve('tmp/github-export/baseline.html'),
  target: 'html' as 'html' | 'pdf' | 'docx',
  mermaidRuntimeSrc: pathToFileURL(path.resolve('webview/dist/mermaid.min.js')).href,
  katexStylesHref: pathToFileURL(path.resolve('webview/dist/katex/katex.min.css')).href,
  baseHref: pathToFileURL(path.dirname(fixture) + path.sep).href,
  title: 'GitHub README baseline',
  shikiLanguageAssetsRoot: path.resolve('webview/dist')
};
const browser = await launchTestBrowser();
try {
  for (const appearance of ['light', 'dark'] as const) {
    const outputHtmlPath = path.resolve(`tmp/github-export/${appearance}.html`);
    const rendered = await exportRuntime.renderExportHtmlDocument({ ...base, outputFilePath: outputHtmlPath, readingSnapshot: { ...base.readingSnapshot, appearance } });
    await exportRuntime.writeHtmlExport({ htmlDocument: rendered.htmlDocument, outputHtmlPath });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 850 });
    await page.goto(pathToFileURL(outputHtmlPath).href);
    await page.waitForFunction(() => (window as any).__MEO_EXPORT_READY__ === true);
    const read = () => page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.markdown-body')!;
      const style = (selector: string) => getComputedStyle(root.querySelector(selector)!);
      return {
        rootWidth: root.clientWidth, contentWidth: root.clientWidth - 64,
        font: getComputedStyle(root).fontFamily, size: getComputedStyle(root).fontSize,
        lineHeight: getComputedStyle(root).lineHeight, background: getComputedStyle(root).backgroundColor,
        h1: [style('h1').fontSize, style('h1').lineHeight, style('h1').fontWeight],
        h2: [style('h2').fontSize, style('h2').lineHeight, style('h2').marginTop],
        cellPadding: style('td').padding, code: [style('pre').fontSize, style('pre').lineHeight, style('pre').padding],
        linkDecoration: style('p a').textDecorationLine,
        keyword: style('.meo-export-code-line-source > span').color,
        checkbox: root.querySelector('input[type="checkbox"]')?.hasAttribute('disabled'),
        footnote: [style('.footnotes').fontSize, style('.footnote-item').display],
        links: ['p a', '.footnote-ref a', '.footnote-backref'].map(selector => [style(selector).color, style(selector).textDecorationLine]),
        keycap: [style('kbd').borderTopWidth, style('kbd').borderTopStyle, style('kbd').boxShadow],
        diagram: root.querySelectorAll('.meo-export-mermaid.is-rendered').length,
        diagramSize: (() => {
          const box = root.querySelector<SVGSVGElement>('.meo-export-mermaid-svg svg')!.viewBox.baseVal;
          return [box.width, box.height];
        })(),
        diagramFill: style('.meo-export-mermaid-svg .node rect').fill,
        formula: root.querySelectorAll('.katex').length,
        formulaAlignment: style('.meo-export-math-display').textAlign,
        diagramCenterOffset: (() => {
          const container = root.querySelector('.meo-export-mermaid')!.getBoundingClientRect();
          const svg = root.querySelector('.meo-export-mermaid-svg svg')!.getBoundingClientRect();
          return (svg.left + svg.right - container.left - container.right) / 2;
        })(),
        expandedMarkdown: root.querySelector('details strong')?.textContent,
        followingContentVisible: root.querySelector('#duplicate-heading')!.getBoundingClientRect().height > 0,
        comments: root.textContent!.includes('hidden HTML comment'),
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    const actual = await read();
    assert.equal(actual.contentWidth, 1012);
    assert.ok(!actual.font.includes('Georgia'));
    assert.equal(actual.size, '16px');
    assert.equal(actual.lineHeight, '24px');
    assert.deepEqual(actual.h1, ['32px', '40px', '600']);
    assert.deepEqual(actual.h2, ['24px', '30px', '24px']);
    assert.equal(actual.cellPadding, '6px 13px');
    assert.equal(actual.linkDecoration, 'underline');
    assert.deepEqual(actual.code, ['13.6px', '19.72px', '16px']);
    assert.equal(actual.keyword, appearance === 'light' ? 'rgb(207, 34, 46)' : 'rgb(255, 123, 114)');
    assert.equal(actual.background, appearance === 'light' ? 'rgb(255, 255, 255)' : 'rgb(13, 17, 23)');
    assert.equal(actual.checkbox, true);
    assert.deepEqual(actual.footnote, ['12px', 'list-item']);
    for (const link of actual.links) assert.deepEqual(link, [appearance === 'light' ? 'rgb(9, 105, 218)' : 'rgb(68, 147, 248)', 'underline']);
    assert.deepEqual(actual.keycap.slice(0, 2), ['1px', 'solid']);
    assert.notEqual(actual.keycap[2], 'none');
    assert.ok(Math.abs(actual.diagramCenterOffset) < 1, 'Exported Mermaid must be centered');
    assert.deepEqual(actual.diagramSize, [632, 144]);
    if (appearance === 'light') assert.equal(actual.diagramFill, 'rgb(236, 236, 255)');
    assert.equal(actual.expandedMarkdown, 'Expanded content');
    assert.equal(actual.followingContentVisible, true, 'Closing details must not hide the rest of the document');
    assert.equal(actual.formulaAlignment, 'center');
    assert.equal(await page.$eval('.footnote-ref a', el => el.getAttribute('href')), `${appearance}.html#fn-1`);
    assert.equal(await page.$eval('.footnote-backref', el => el.getAttribute('href')), `${appearance}.html#fnref-1`);
    assert.ok(await page.$('#fnref-1'), 'Footnote backlinks must point to an existing reference anchor');
    assert.ok(actual.diagram === 1 && actual.formula >= 3 && !actual.comments && !actual.documentOverflow, JSON.stringify(actual));
    await page.screenshot({ path: `tmp/github-export/${appearance}.png`, fullPage: true });
    await page.setViewport({ width: 480, height: 850 });
    assert.equal((await read()).rootWidth, 480);
    assert.equal((await read()).documentOverflow, false);
    assert.ok(Math.abs((await read()).diagramCenterOffset) < 1, 'Narrow exported Mermaid must stay centered');
    await page.emulateMediaType('print');
    const printOverflow = await page.evaluate(() => [...document.querySelectorAll('pre, table')].filter(element => element.scrollWidth > element.clientWidth + 1).length);
    assert.equal(printOverflow, 0, 'PDF code and tables must wrap rather than clip');
    await page.close();
    const pdf = await exportRuntime.renderExportHtmlDocument({ ...base, target: 'pdf', readingSnapshot: { ...base.readingSnapshot, appearance } });
    const pdfHtmlPath = path.resolve(`tmp/github-export/${appearance}-pdf.html`);
    await exportRuntime.writeHtmlExport({ htmlDocument: pdf.htmlDocument, outputHtmlPath: pdfHtmlPath });
    const pdfPage = await browser.newPage();
    await pdfPage.setViewport({ width: 793, height: 1122 });
    // Production PDF rendering intentionally uses screen media for its fit pass.
    await pdfPage.emulateMediaType('screen');
    await pdfPage.goto(pathToFileURL(pdfHtmlPath).href);
    await pdfPage.waitForFunction(() => (window as any).__MEO_EXPORT_READY__ === true);
    assert.deepEqual(await pdfPage.evaluate(() => [...document.querySelectorAll('pre, table')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth }))), [], 'Production PDF must not retain screen-only horizontal scrolling');
    assert.ok(await pdfPage.evaluate(() => {
      const root = document.querySelector('.meo-export-math-display')!.getBoundingClientRect();
      const formula = document.querySelector('.meo-export-math-display .katex')!.getBoundingClientRect();
      return Math.abs((root.left + root.right) / 2 - (formula.left + formula.right) / 2) < 2;
    }), 'Display formulas must actually be centered after the math runtime wraps them');
    await pdfPage.close();
    const outputPdfPath = path.resolve(`tmp/github-export/${appearance}.pdf`);
    await exportRuntime.renderPdfFromHtmlExport({ htmlDocument: pdf.htmlDocument, outputPdfPath, puppeteerRuntimeModulePath: path.resolve('dist/puppeteer-runtime.js') });
    assert.ok(readFileSync(outputPdfPath).subarray(0, 5).equals(Buffer.from('%PDF-')));
  }
  const word = await exportRuntime.renderExportHtmlDocument({ ...base, target: 'docx', readingSnapshot: { ...base.readingSnapshot, appearance: 'dark' } });
  assert.ok(!word.htmlDocument.includes('class="meo-export-doc markdown-body"') && word.htmlDocument.includes('--meo-bg: #ffffff'));
  assert.ok(word.htmlDocument.includes('Georgia') && !word.htmlDocument.includes('color:#FF7B72'));
  console.log('GitHub measured layout, responsive width, HTML/PDF export and Word isolation passed.');
} finally {
  await browser.close();
}
