import { parser, type MarkdownConfig } from '@lezer/markdown';

export const WIKI_IMAGE_SCHEME = 'meo-wiki-image:';
export const WIKI_LINK_SCHEME = 'meo-wiki:';

export type WikiReference = {
  target: string;
  label: string;
  embed: boolean;
  from: number;
  to: number;
  width?: number;
  height?: number;
};

export function isWikiImageTarget(target: string): boolean {
  return /\.(?:png|jpe?g|jfif|gif|webp|avif|svg|bmp|ico|tiff?)(?:#.*)?$/i.test(target);
}

/** Wiki destinations are literal filenames; URI decoding belongs to transport only. */
export function parseWikiReference(text: string, from = 0): WikiReference | null {
  const embed = text.startsWith('![[', from);
  const start = from + (embed ? 3 : 2);
  if (!embed && !text.startsWith('[[', from)) return null;
  let slashes = 0;
  for (let i = from - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  if (slashes % 2) return null;
  const end = text.indexOf(']]', start);
  if (end < 0) return null;
  // Nested bracket labels with an explicit destination belong to standard Markdown.
  if (text[end + 2] === '(' || text[end + 2] === '[') return null;
  const content = text.slice(start, end);
  if (/[\r\n]/.test(content) || content.includes('[[')) return null;
  const pipe = content.indexOf('|');
  // GFM tables require the separator to be escaped in the source.
  const target = (pipe < 0 ? content : content.slice(0, pipe).replace(/\\$/, '')).trim();
  if (!target) return null;
  const alias = pipe < 0 ? '' : content.slice(pipe + 1).trim();
  const dimensions = embed ? /^(\d+)(?:x(\d+))?$/.exec(alias) : null;
  const width = dimensions ? Number(dimensions[1]) : undefined;
  const height = dimensions?.[2] ? Number(dimensions[2]) : undefined;
  const validSize = width !== undefined && width > 0 && width <= 100_000
    && (height === undefined || (height > 0 && height <= 100_000));
  return {
    target, label: embed ? target.split(/[\\/]/).at(-1) ?? target : alias || target,
    embed, from, to: end + 2,
    ...(validSize ? { width, ...(height ? { height } : {}) } : {})
  };
}

export function wikiImageSrc(target: string): string {
  return `${WIKI_IMAGE_SCHEME}${encodeURIComponent(target)}`;
}

export function wikiTargetFromImageSrc(src: string): string | null {
  if (!src.startsWith(WIKI_IMAGE_SCHEME)) return null;
  try { return decodeURIComponent(src.slice(WIKI_IMAGE_SCHEME.length)); } catch { return null; }
}

/** Add an image node with the complete source range, including optional dimensions. */
export const wikiImageMarkdownExtension: MarkdownConfig = {
  parseInline: [{
    name: 'WikiImage', before: 'Image',
    parse(context, next, pos) {
      if (next !== 33) return -1;
      const reference = parseWikiReference(context.text, pos - context.offset);
      if (!reference?.embed || !isWikiImageTarget(reference.target)) return -1;
      const end = context.offset + reference.to;
      return context.addElement(context.elt('Image', pos, end, [
        context.elt('LinkMark', pos, pos + 3),
        context.elt('LinkMark', end - 2, end)
      ]));
    }
  }]
};

const wikiParser = parser.configure(wikiImageMarkdownExtension);

/** Parser-owned ranges exclude code and escapes; paired HTML code is also literal. */
export function collectWikiReferences(text: string): WikiReference[] {
  if (!text.includes('[[')) return [];
  const references: WikiReference[] = [];
  const seen = new Set<number>();
  const tree = wikiParser.parse(text);
  const htmlStack: Array<{ name: string; from: number }> = [];
  const literalRanges: Array<{ from: number; to: number }> = [];
  tree.iterate({ enter(node) {
    if (node.name !== 'HTMLTag') return;
    const source = text.slice(node.from, node.to);
    const tag = /^<(\/)?(code|kbd)\b/i.exec(source);
    if (!tag || /\/\s*>$/.test(source)) return;
    const name = tag[2].toLowerCase();
    if (!tag[1]) htmlStack.push({ name, from: node.from });
    else {
      let open = htmlStack.length - 1;
      while (open >= 0 && htmlStack[open].name !== name) open--;
      if (open >= 0) { literalRanges.push({ from: htmlStack[open].from, to: node.to }); htmlStack.splice(open); }
    }
  }});
  tree.iterate({ enter(node) {
    if (node.name !== 'Link' && node.name !== 'Image') return;
    if (node.node.parent?.name === 'Image') return false;
    const from = text.startsWith('[[', node.from) || text.startsWith('![[', node.from) ? node.from : node.from - 1;
    const reference = parseWikiReference(text, from);
    if (!reference || reference.to > node.to + 1 || seen.has(from) || literalRanges.some(range => from >= range.from && from < range.to)) return;
    seen.add(from);
    references.push(reference);
    return false;
  }});
  return references;
}

export type ResolvedWikiResource = { uri?: string; issue?: string };
export type ResolvedWikiResources = Record<string, ResolvedWikiResource>;
