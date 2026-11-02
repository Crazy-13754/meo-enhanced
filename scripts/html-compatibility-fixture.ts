import assert from 'node:assert/strict';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import { isSafeHtmlUrl, normalizeHtmlAttribute, mapHtmlSrcset } from '../src/shared/htmlPolicy';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwbvr2HwAFYgKzn+LXXwAAAABJRU5ErkJggg==';
export const htmlCompatibilityImage = image;
export const htmlCompatibilityDoubleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGOwbvr2H4QZYAwAW5oKySiUrEcAAAAASUVORK5CYII=';
export const htmlTextShadowExample = '<h1 style="text-shadow: 5px 5px 5px #FF0000;">Text-shadow effect!</h1>';
export const htmlCompatibilityFixture = `
<div id="compat-text-shadow">${htmlTextShadowExample}</div>

<svg id="compat-star" xmlns="http://www.w3.org/2000/svg" height="190"><polygon points="100,10 40,180 190,60 10,60 160,180" style="fill:lime;stroke:purple;stroke-width:5;fill-rule:evenodd;clip-rule:evenodd"></svg>

<p id="compat-rounded-fill" style="border-radius:25px;background:#8AC007;padding:20px;width:200px;height:20px;text-align:center">圆角</p>

<p id="compat-rounded-border" style="border-radius:25px;border:2px solid #8AC007;padding:20px;width:200px;height:20px;text-align:center">圆角</p>

<p id="compat-rounded-authored" class="compat-border-box" style="border-radius:25px;border:2px solid #8AC007;padding:20px;width:200px;height:60px;text-align:center">Authored box</p>

Inline <samp id="compat-inline">output</samp> <var>x</var> <time datetime="2026-10-29">today</time> <cite>citation</cite> <ins>inserted</ins> <bdi>text</bdi>.

Inline box: <span id="compat-inline-box" style="display:inline-block;width:160px;height:24px;padding:12px;border:2px solid #2563eb;text-align:center;line-height:20px">Inline authored box</span> after.

Nested box: <span style="display:inline-block"><em id="compat-inline-nested" style="display:inline-block;width:80px;height:20px;padding:5px;border:1px solid #2563eb">Nested</em></span> after.

Author stylesheet: <span id="compat-inline-rule" class="compat-sized">Rule box</span>; explicit model: <span id="compat-inline-explicit" class="compat-border-box" style="display:inline-block;width:188px;height:52px;padding:12px;border:2px solid #2563eb">Explicit box</span>.

<aside id="compat-structure" class="compat-grid" aria-label="HTML example" data-kind="example" style="--Accent:rgb(12, 90, 140)">
<header><dfn>Definition</dfn><wbr><samp>output</samp></header>
<div id="compat-flex" style="display:flex;gap:8px;align-items:center"><b>Flex</b><span>item</span></div>
<svg id="compat-svg" width="24" height="16" viewBox="0 0 24 16"><defs><linearGradient id="compat-gradient"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs><rect width="24" height="16" fill="url(#compat-gradient)"/></svg>
<math id="compat-math"><mfrac><mi>x</mi><mn>2</mn></mfrac></math>
<form id="compat-form" action="https://example.invalid/submit"><label><input id="compat-check" type="checkbox" checked disabled>Check</label><button type="button">Button</button><select><option selected>Choice</option></select></form>
<picture><source srcset="compat-picture.png 1x, compat-picture-2x.png 2x" type="image/png"><img id="compat-picture" src="compat-picture.png" alt="Picture" width="16" height="16"></picture>
<audio id="compat-audio" controls preload="none"></audio><video id="compat-video" controls preload="none" width="40" height="24" poster="${image}"></video>
</aside>

<div id="compat-mixed">

**Mixed Markdown**

</div>

<div id="compat-paint" class="compat-paint"></div>

<style>
.compat-grid {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;color:var(--Accent)}
.compat-paint {width:24px;height:12px;background-color:red}
.compat-border-box {box-sizing:border-box}
.compat-sized {display:inline-block;width:160px;height:24px;padding:12px;border:2px solid #2563eb}
#app {border:99px solid red}
@import "https://example.invalid/style.css";
</style>
`;

export function checkHtmlCompatibilityExport(): void {
  for (const target of ['html', 'pdf', 'docx'] as const) {
    const html = renderMarkdownToHtml({ markdownText: htmlCompatibilityFixture, markdownFilePath: '/fixture/compatibility.md', target }).html;
    for (const tag of ['aside', 'header', 'dfn', 'samp', 'var', 'time', 'cite', 'ins', 'bdi', 'wbr', 'svg', 'linearGradient', 'math', 'mfrac', 'form', 'input', 'select', 'picture', 'source', 'audio', 'video']) {
      assert.ok(html.includes(`<${tag}`), `${target}: ${tag} is supported`);
    }
    assert.match(html, /class="compat-grid" aria-label="HTML example" data-kind="example"/);
    assert.match(html, /viewBox="0 0 24 16"/); assert.match(html, /<strong>Mixed Markdown<\/strong>/);
    assert.match(html, /text-shadow:5px 5px 5px #FF0000/);
    assert.match(html, /@scope /); assert.doesNotMatch(html, /@import|action=/);
  }
  const mixed = renderMarkdownToHtml({ markdownText: '<div><custom-html>Unknown</custom-html><p>Still rendered</p><script>window.bad="<img>"</script></div>', markdownFilePath: '/fixture/compatibility.md', target: 'html' }).html;
  assert.match(mixed, /<p>Still rendered<\/p>/); assert.doesNotMatch(mixed, /<script>|<custom-html>/);
  for (const value of ['javascript:alert(1)', 'java\nscript:alert(1)', '\u0000javascript:alert(1)', 'data:text/html,test']) assert.equal(isSafeHtmlUrl(value, 'href'), false, value);
  assert.equal(normalizeHtmlAttribute('p', 'data-meo-preview-block', '0'), null);
  assert.equal(normalizeHtmlAttribute('p', 'onclick', 'alert(1)'), null);
  assert.equal(mapHtmlSrcset('one.png 1x, two.png 2x', value => `mapped/${value}`), 'mapped/one.png 1x, mapped/two.png 2x');
  const uppercase = renderMarkdownToHtml({ markdownText: '<DIV><H1 STYLE="text-shadow:5px 5px 5px red">Uppercase</H1><P CLASS="note">Body</P></DIV>',markdownFilePath:'/fixture/compatibility.md',target:'html' }).html;
  assert.match(uppercase, /<div><h1 style="text-shadow:5px 5px 5px red">Uppercase<\/h1><p class="note">Body<\/p><\/div>/);
  const github = renderMarkdownToHtml({ markdownText: htmlCompatibilityFixture, markdownFilePath: '/fixture/compatibility.md', target: 'html', preset: 'github-readme' }).html;
  assert.doesNotMatch(github, /<style>|<svg|<math|<audio|<video|<input|class="compat-grid"/);
  console.log('HTML compatibility: shared document tags, attributes, CSS, native content, CommonMark and GitHub isolation passed');
}
