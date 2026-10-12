import { inlineCodeMarkers } from '../application/symbolInput';

export function safeClipboardUrl(value: string): string | null {
  const url = value.trim();
  return url && !/[\u0000-\u0020]/.test(url) && /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

const escapeText = (value: string) => value.replace(/\s+/g, ' ').replaceAll('&', '&amp;').replace(/[\\`*_\[\]]/g, '\\$&').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const destination = (value: string) => value.trim().replace(/\s/g, '%20').replaceAll('\\', '%5C').replaceAll('(', '%28').replaceAll(')', '%29');
const ignoredTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'IFRAME', 'OBJECT', 'SVG'];
function allowedDestination(value: string): boolean {
  value = value.trim();
  return !!value && !/[\u0000-\u001f]/.test(value) && !/^(?:javascript|data|vbscript|file):/i.test(value)
    && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:https?|mailto):/i.test(value));
}

export function parseClipboardHtml(html: string): HTMLElement | null {
  if (!html || html.length > 5_000_000) return null;
  return new DOMParser().parseFromString(html, 'text/html').body;
}

/** Structural blocks at either edge need separation from the destination paragraph. */
export function clipboardHtmlBlockEdges(root: Element): { start: boolean; end: boolean } {
  const edge = (parent: Element, end: boolean): boolean | null => {
    const nodes = Array.from(parent.childNodes);
    if (end) nodes.reverse();
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
      if (!(node instanceof Element) || ignoredTags.includes(node.tagName)) continue;
      if (['TABLE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'HR'].includes(node.tagName) || /^H[1-6]$/.test(node.tagName)) return true;
      if (node.tagName === 'IMG' && allowedDestination(node.getAttribute('src') ?? '')) return false;
      const child = edge(node, end);
      if (child !== null) return child;
    }
    return null;
  };
  return { start: edge(root, false) ?? false, end: edge(root, true) ?? false };
}

/** Converts inert clipboard HTML to Markdown, never inserting HTML DOM. Elements reuse a parsed fragment; only their children are converted. */
export function clipboardHtmlToMarkdown(html: string | Element, tableToMarkdown?: (table: Element) => string | null): string | null {
  const root = typeof html === 'string' ? parseClipboardHtml(html) : html;
  if (!root) return null;
  const children = (node: Node): string => Array.from(node.childNodes, convert).join('');
  const convert = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const tag = node.tagName;
    if (ignoredTags.includes(tag)) return '';
    if (tag === 'PRE') {
      const value = (node.textContent ?? '').replace(/\r\n?/g, '\n');
      let length = 3; for (const match of value.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
      const fence = '`'.repeat(length);
      return '\n\n' + fence + '\n' + value.replace(/\n$/, '') + '\n' + fence + '\n\n';
    }
    if (tag === 'CODE') {
      const value = node.textContent ?? '';
      const { open, close } = inlineCodeMarkers(value);
      return open + value + close;
    }
    if (tag === 'BR') return '<br>\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'TABLE' && tableToMarkdown) {
      const table = tableToMarkdown(node);
      if (table !== null) {
        const caption = Array.from(node.children).find(child => child.tagName === 'CAPTION');
        return '\n\n' + (caption ? children(caption).trim() + '\n\n' : '') + table + '\n\n';
      }
    }
    const content = children(node);
    const styled = (marker: string) => content.trim() ? content.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_match, before: string, text: string, after: string) => before + marker + text + marker + after) : content;
    if (['B', 'STRONG'].includes(tag)) return styled('**');
    if (['I', 'EM'].includes(tag)) return styled('*');
    if (['S', 'STRIKE', 'DEL'].includes(tag)) return styled('~~');
    if (tag === 'MARK') return styled('==');
    if (tag === 'U') return '<u>' + content + '</u>';
    if (tag === 'KBD') return '<kbd>' + content + '</kbd>';
    if (tag === 'A') {
      const href = node.getAttribute('href') ?? '';
      return allowedDestination(href) ? '[' + content + '](' + destination(href) + ')' : content;
    }
    if (tag === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      return allowedDestination(src) ? '![' + escapeText(node.getAttribute('alt') ?? '') + '](' + destination(src) + ')' : '';
    }
    if (/^H[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + content.trim() + '\n\n';
    if (tag === 'BLOCKQUOTE') return '\n\n' + content.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (tag === 'UL' || tag === 'OL') {
      const start = tag === 'OL' ? Number(node.getAttribute('start') ?? 1) : 1;
      return '\n\n' + Array.from(node.children).filter(child => child.tagName === 'LI').map((item, index) => {
        const marker = tag === 'OL' ? `${Number.isFinite(start) ? start + index : index + 1}. ` : '- ';
        return marker + children(item).trim().split('\n').map((line, lineIndex) => lineIndex ? ' '.repeat(marker.length) + line : line).join('\n');
      }).join('\n') + '\n\n';
    }
    if (tag === 'TD' || tag === 'TH') return content.trim() + '\t';
    if (['P', 'DIV', 'SECTION', 'ARTICLE', 'TR', 'TABLE'].includes(tag)) return '\n\n' + content.trim() + '\n\n';
    return content;
  };
  return children(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}
