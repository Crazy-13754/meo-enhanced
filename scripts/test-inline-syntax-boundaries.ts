import assert from 'node:assert/strict';
import { parseDocument } from 'htmlparser2';
import type { ChildNode } from 'domhandler';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown';
import exportRuntime from '../src/export/runtime';
import { EditorState } from '@codemirror/state';
import { editorMarkdownLanguage } from '../webview/src/liveMode';
import { extractHeadings } from '../webview/src/helpers/markdownSyntax';
import { inlineSyntaxBoundaryFixtures, type InlineBoundaryStyle } from './inline-syntax-boundary-fixtures';

const styleTags: Record<string, InlineBoundaryStyle> = { em: 'emphasis', i: 'emphasis', strong: 'strong', b: 'strong', s: 'strikethrough', del: 'strikethrough', mark: 'highlight', code: 'code', sub: 'subscript', sup: 'superscript' };
const failures: string[] = [];
for (const fixture of inlineSyntaxBoundaryFixtures) {
  const results = [
    ...(['html', 'pdf', 'docx'] as const).map(target => ({ name: target, html: renderMarkdownToHtml({ markdownText: fixture.markdown, markdownFilePath: 'C:/tmp/inline-boundaries.md', target, showComments: true }).html })),
    { name: 'preview', html: exportRuntime.renderPreviewDocument({ markdownText: fixture.markdown, sourceDocumentPath: 'C:/tmp/inline-boundaries.md', uiLanguage: 'en', styleEnvironment: { previewFontFamily: '', previewShowComments: true } }).html }
  ];
  for (const result of results) {
    try {
      const targets: InlineBoundaryStyle[][] = [];
      const links: string[] = [];
      let text = '', mathCount = 0;
      const visit = (nodes: readonly ChildNode[], styles: InlineBoundaryStyle[] = []) => {
        for (const node of nodes) {
          if (node.type === 'text') {
            text += node.data;
            if (node.data.includes('TARGET')) targets.push([...new Set(styles)].sort());
          } else if ('children' in node) {
            if ('attribs' in node) {
              if (/\bmeo-export-math\b/.test(node.attribs.class ?? '')) { mathCount += 1; continue; }
              if (node.name === 'a') links.push(node.attribs.href ?? '');
            }
            const style = 'name' in node ? styleTags[node.name] : undefined;
            visit(node.children, style ? [...styles, style] : styles);
          }
        }
      };
      visit(parseDocument(result.html).children);
      assert.deepEqual(targets, [[...fixture.styles].sort()], 'target formatting');
      if (fixture.literal) assert.ok(text.includes(fixture.literal), `missing literal ${fixture.literal}`);
      if (fixture.mathCount !== undefined) assert.equal(mathCount, fixture.mathCount, 'math count');
      if (fixture.href) assert.deepEqual(links, [fixture.href], 'complete, unnested link');
    } catch (error) { failures.push(`${fixture.name}/${result.name}: ${String(error)}`); }
  }
}
for (const marker of ['*', '**', '~~', '==']) {
  const text = `(TARGET${marker})(b${marker})`;
  const state = EditorState.create({ doc: `# \`${text}\``, extensions: [editorMarkdownLanguage] });
  const heading = extractHeadings(state)[0]!;
  try {
    assert.equal(heading.text, text, 'outline preserves code text');
    assert.ok(heading.inlineSegments?.every(segment => !segment.strong && !segment.emphasis && !segment.strikethrough && !segment.highlight));
  } catch (error) { failures.push(`heading-${marker}: ${String(error)}`); }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Inline syntax boundaries passed (${inlineSyntaxBoundaryFixtures.length} fixtures, Preview and three export targets, outline).`);
