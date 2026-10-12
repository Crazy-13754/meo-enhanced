import { parseDocument } from 'htmlparser2';
import type { ChildNode } from 'domhandler';

// Compare reading semantics, excluding GitHub UI wrappers, source positions,
// syntax-highlighting spans, MathJax/KaTeX internals and generated footnote IDs.
export function githubReadmeSemantics(html: string) {
  let text = '';
  const links: string[] = [];
  const images: Array<{ alt: string; src: string }> = [];
  const elements: string[] = [];
  const semanticTags = new Set('u input ins tt var samp q ruby rt rp picture source mark s strike del details summary section strong em h1 h2 h3 h4 h5 h6 br'.split(' '));
  const scan = (nodes: readonly ChildNode[]) => {
    for (const node of nodes) {
      if (node.type === 'text') { text += node.data; continue; }
      if (!('name' in node)) continue;
      const attributes = node.attribs;
      const className = attributes.class ?? '';
      if (/\b(anchor|meo-export-code-language-label|meo-export-code-line-number|data-footnote-backref|katex-mathml|footnotes)\b/.test(className)
        || attributes['data-footnote-backref'] !== undefined || attributes.id === 'footnote-label') continue;
      if (node.name === 'sup' && node.children.some(child => 'name' in child && child.name === 'a'
        && /^#(?:user-content-)?fn/.test(child.attribs.href ?? ''))) { text += '[footnote]'; continue; }
      if (attributes['data-type'] || className.includes('meo-export-mermaid')) {
        text += `[${attributes['data-type'] ?? 'mermaid'}]`; continue;
      }
      if (node.name === 'math-renderer' || className.includes('meo-export-math')) { text += '[math]'; continue; }
      if (node.name === 'svg') continue;
      if (node.name === 'a' && attributes.href && !node.children.some(child => 'name' in child && child.name === 'img')) {
        links.push(attributes.href.replace('#user-content-', '#'));
      }
      if (node.name === 'img') {
        const source = attributes['data-meo-deferred-image-src'] ?? attributes.src ?? '';
        images.push({ alt: attributes.alt ?? '', src: source.startsWith('data:') ? ''
          : source.replace(/^\/huangko555\/meo-preview-github-baseline\/raw\/main\//, '').replace(/\?v\d+$/, '') });
      }
      if (semanticTags.has(node.name)) elements.push(node.name);
      if (node.name === 'br') text += '\n';
      scan(node.children);
      if (['p', 'div', 'pre', 'li'].includes(node.name) || className.includes('meo-export-code-line')) text += '\n';
    }
  };
  scan(parseDocument(html).children);
  return { text: text.replace(/\s+/g, ' ').trim(), links, images, elements };
}
