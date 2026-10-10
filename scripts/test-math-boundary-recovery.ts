import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { scanLatexMath } from '../src/shared/latexMathScanner';
import { installMathTransform } from '../src/export/mathTransform';

const md = new MarkdownIt();
installMathTransform(md);
const cases = [
  { source: '$$\n\n$$x^2$$\n\n## Heading\n\n$y$', content: ['x^2', 'y'] },
  { source: '$$\nx=1\n\n## Heading\n\n$$\ny=2\n$$', content: ['y=2'] },
  { source: '> $$\n> x=1\n\n$$\ny=2\n$$', content: ['y=2'] },
  { source: '$$\nx=1\n```js\nconst x=1\n```\n\n$$\ny=2\n$$', content: ['y=2'] },
  { source: '$$$$x$$$$ and $$$y$$$ then $z$', content: ['z'] },
  { source: '$5$ and $2+2$ and $12.50$', content: ['5', '2+2', '12.50'] },
  { source: '$ x $ and $x $ and $ x$ and $$ x $$', content: ['x'] },
  { source: 'Pay $5 and $10. Use $x$2 then $y$.', content: ['y'] },
  { source: '$$\n\n\\frac{\n\n$$\n\n## Heading', content: ['\\frac{'] },
  { source: '> - $$\n>   x=1\n>   \n>   $$', content: ['x=1'] },
  { source: '$$\n> x\n+ y\n- z\n$$', content: ['> x\n+ y\n- z'] },
  { source: '- $$\n  x=1\n\n## Heading\n\n$$\ny=2\n$$', content: ['y=2'] },
  { source: '> $$\n> x=1\n> ## Heading\n\n$$x^2$$', content: ['x^2'] },
  { source: '$$\nx=1\n\n> $$\n> y=2\n> $$', content: ['y=2'] }
];
for (const { source, content } of cases) {
  assert.deepEqual(scanLatexMath(source).map(range => range.content), content, source);
  const html = md.render(source);
  assert.equal((html.match(/class="meo-export-math /g) ?? []).length, content.length, html);
  if (source.includes('## Heading')) assert.ok(html.includes('<h2>Heading</h2>'), html);
}
console.log(`Math boundary recovery passed: ${cases.length} scanner/HTML cases`);
