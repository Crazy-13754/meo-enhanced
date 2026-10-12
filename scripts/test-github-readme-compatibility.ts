import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import { githubPictureMedia } from '../src/shared/githubPicture';
import { githubReadmeSemantics } from './github-readme-semantics';

const fixture = JSON.parse(readFileSync('scripts/fixtures/github-readme/compatibility.json', 'utf8'));
const render = (markdownText: string, preset: 'github-readme' | 'default' = 'github-readme', deferImages = true) => renderMarkdownToHtml({
  markdownText, preset, deferImages, markdownFilePath: 'C:/audit/README.md', target: 'html'
}).html;
const failures: string[] = [];
for (const probe of fixture.probes) {
  if (probe.pending) continue;
  try { assert.deepEqual(githubReadmeSemantics(render(probe.markdown)), probe.expected); }
  catch { failures.push(`${probe.id}: ${probe.name ?? probe.id}`); }
}
assert.deepEqual(failures, [], 'GitHub README semantics differ from the captured native Preview');
assert.deepEqual(fixture.probes.filter((probe: { pending?: string }) => probe.pending).map((probe: { id: string }) => probe.id), ['P79', 'P80', 'P81']);

const anchor = render('<a id="custom-id" name="custom-name"></a>\n\n[ID](#custom-id) [NAME](#custom-name)');
assert.match(anchor, /id="user-content-custom-id" name="user-content-custom-name"/);
assert.match(anchor, /href="#user-content-custom-id"/);
assert.match(anchor, /href="#user-content-custom-name"/);
const headings = render('# Repeat\n\n<h2>Repeat</h2>\n\n# Repeat');
assert.deepEqual([...headings.matchAll(/id="([^"]+)"/g)].map(match => match[1]), ['repeat', 'repeat-1', 'repeat-2']);
assert.match(render('<h1 id="custom">Raw heading</h1>'), /id="user-content-custom"[^>]*><a id="raw-heading"><\/a>/);

const attrs = render('<p id="attrs" title="Tip" dir="rtl" lang="en" align="center" style="color:red" class="custom" onclick="audit()">TEXT</p>');
for (const attribute of ['title="Tip"', 'dir="rtl"', 'lang="en"', 'align="center"', 'id="user-content-attrs"']) assert.ok(attrs.includes(attribute), attribute);
for (const attribute of ['color:red', 'class="custom"', 'onclick']) assert.ok(!attrs.includes(attribute), attribute);
assert.match(render('<table width="80%" border="1"><tr><td align="center" valign="top" width="50" colspan="2">CELL</td></tr></table>'), /<table[^>]*width="80%"[^>]*><tr><td align="center" valign="top" width="50" colspan="2">/);

const picture = render('<picture><source srcset="sample.svg" media="(prefers-color-scheme: dark)"><img src="sample.svg"></picture>');
assert.ok(picture.includes('data-meo-deferred-image-srcset="sample.svg"'));
assert.ok(picture.includes('data-meo-deferred-image-src="sample.svg"'));
for (const source of ['data:image/png;base64,AUDIT', 'file:///C:/audit/image.png', '//example.com/image.png']) {
  const html = render(`<img src="${source}" data-meo-deferred-image-src="file:///C:/audit/bypass.png"><picture><source srcset="${source}" data-meo-deferred-image-srcset="file:///C:/audit/bypass.png"></picture>`);
  assert.ok(!html.includes('data-meo-deferred-image-'), html);
}
assert.ok(!render('<source srcset="sample.svg 1x, sample.svg 2x">').includes('srcset='));
assert.equal(githubPictureMedia('(prefers-color-scheme: dark)', 'dark'), 'all');
assert.equal(githubPictureMedia('(prefers-color-scheme: dark)', 'light'), 'not all');
assert.equal(githubPictureMedia('(min-width: 600px)', 'dark'), '(min-width: 600px)');

const protectedEmoji = render('<code>:smile: $x$ **bold**</code>\n\n$\\text{:smile:}$');
assert.ok(protectedEmoji.includes('<code>:smile: $x$ <strong>bold</strong></code>'));
assert.ok(!protectedEmoji.includes('😄'));
assert.ok(render(':octocat:').includes('data-meo-deferred-image-src="https://github.githubassets.com/'));
const sourceImage = render('<picture><source srcset="sample.svg"><img src="sample.svg"></picture>', 'github-readme', false);
assert.ok(sourceImage.includes('srcset="sample.svg"') && sourceImage.includes('src="sample.svg"'));
const embeddedImage = renderMarkdownToHtml({ markdownText: '<picture><source srcset="sample.svg"><img src="sample.svg"></picture>',
  markdownFilePath: 'scripts/fixtures/github-readme/README.md', target: 'html', preset: 'github-readme' }).html;
assert.ok(embeddedImage.includes('srcset="data:image/svg+xml;base64,') && embeddedImage.includes('src="data:image/svg+xml;base64,'));

assert.ok(render('H~2~O :smile: <u>underlined</u>', 'default').includes('<sub>2</sub>O :smile: <u>underlined</u>'));
assert.ok(render('```Math\nx^2\n```', 'default').includes('meo-export-math'));
assert.ok(!render('<input type="checkbox" checked disabled>').includes('<input'));
assert.ok(render('- [x] Generated task').includes('<input'));
console.log(`GitHub README: ${fixture.probes.length - 3} native Preview semantic probes and focused resource/anchor regressions passed; 3 viewer gaps remain explicit.`);
