import { parseDocument } from 'htmlparser2';
import type { ChildNode } from 'domhandler';
import { sanitizeHtmlStylesheet } from './htmlStyle';

/** Extract only real style elements, never Markdown code. The caller supplies
 * HTML tokens from its authoritative Markdown parse. */
export function inspectHtmlStylesheets(source: string): { css: string; html: string } {
  if (!/<style\b/i.test(source)) return { css: '', html: source };
  const ranges: Array<{ from: number; to: number; css: string }> = [];
  const visit = (nodes: readonly ChildNode[]): void => {
    for (const node of nodes) {
      if ('children' in node && 'attribs' in node && node.name === 'style' && node.startIndex !== null && node.endIndex !== null) {
        const text = node.children.map(child => child.type === 'text' ? child.data : '').join('');
        const css = !node.attribs.type || /^text\/css$/i.test(node.attribs.type) ? sanitizeHtmlStylesheet(text) : '';
        const media = node.attribs.media;
        ranges.push({ from: node.startIndex, to: node.endIndex + 1,
          css: media && !/[{}<>\\]|url\s*\(/i.test(media) ? `@media ${media}{${css}}` : css });
      } else if ('children' in node) visit(node.children);
    }
  };
  visit(parseDocument(source, { withStartIndices: true, withEndIndices: true }).children);
  let html = source;
  for (const range of [...ranges].reverse()) html = html.slice(0, range.from) + html.slice(range.to);
  return { css: ranges.map(range => range.css).join('\n'), html };
}
