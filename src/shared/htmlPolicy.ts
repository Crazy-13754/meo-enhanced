import { scanHtmlTags } from '../foundation/htmlSyntax';
import { normalizeLinkDestination } from '../foundation/linkDestination';

// Author HTML only. GitHub README keeps its separately calibrated policy.
// Rendering, source completion and both sanitizers consume these same sets.
const additionalDocumentTags = 'address aside bdi bdo big center cite dfn fieldset legend form label input button select optgroup option textarea output datalist meter progress time ins samp var tt strike wbr main nav header footer hgroup menu search audio video source track picture style'.split(' ');
export const svgHtmlTags = 'svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textpath title desc marker pattern clippath mask lineargradient radialgradient stop'.split(' ');
export const mathHtmlTags = 'math mrow mi mn mo ms mtext mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mfenced menclose mpadded mphantom semantics annotation'.split(' ');
const svgTagCase: Readonly<Record<string, string>> = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', textpath: 'textPath' };
const svgAttributeCase = Object.fromEntries('viewBox preserveAspectRatio gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform markerWidth markerHeight markerUnits refX refY clipPathUnits maskUnits maskContentUnits textLength lengthAdjust'.split(' ').map(name => [name.toLowerCase(), name]));
export function canonicalHtmlTagName(name: string): string { return svgTagCase[name.toLowerCase()] ?? name.toLowerCase(); }
export function canonicalHtmlAttributeName(name: string): string { return svgAttributeCase[name.toLowerCase()] ?? name.toLowerCase(); }

export const supportedHtmlTags = new Set([
  ...additionalDocumentTags, ...svgHtmlTags, ...mathHtmlTags,
  'a',
  'abbr',
  'article',
  'b',
  'blockquote',
  'br',
  'code',
  'caption',
  'col',
  'colgroup',
  'del',
  'dl',
  'dt',
  'dd',
  'details',
  'div',
  'em',
  'figure',
  'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'ruby', 'rt', 'rp',
  's',
  'span',
  'section',
  'small',
  'strong',
  'summary',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul'
]);

export const supportedHtmlBlockTags = new Set([
  ...'address aside center fieldset form main nav header footer hgroup menu search audio video picture svg math style'.split(' '),
  'dl',
  'article',
  'blockquote',
  'details',
  'div',
  'figure',
  'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr',
  'img',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul'
]);

export const renderedHtmlTagNames = [...supportedHtmlTags].filter(tag => tag !== 'style').map(canonicalHtmlTagName);

export const supportedInlineHtmlTags = new Set([
  ...supportedHtmlTags
].filter(tag => (!supportedHtmlBlockTags.has(tag) || ['img', 'svg', 'math', 'picture', 'audio', 'video'].includes(tag))
  && !['br', 'style', ...svgHtmlTags.filter(tag => tag !== 'svg'), ...mathHtmlTags.filter(tag => tag !== 'math')].includes(tag)));

const globalAttributes = new Set(['id', 'class', 'title', 'style', 'hidden', 'lang', 'dir', 'role', 'tabindex']);
const attributesByTag: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'name', 'title', 'target', 'rel', 'hreflang', 'type']),
  abbr: new Set(['title']),
  blockquote: new Set(['cite']), q: new Set(['cite']),
  ins: new Set(['cite', 'datetime']), del: new Set(['cite', 'datetime']), time: new Set(['datetime']),
  details: new Set(['open', 'name']),
  div: new Set(['align']),
  img: new Set(['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'align', 'loading', 'decoding']),
  source: new Set(['src', 'srcset', 'sizes', 'type', 'media', 'width', 'height']),
  audio: new Set(['src', 'controls', 'loop', 'muted', 'preload', 'controlslist']),
  video: new Set(['src', 'poster', 'controls', 'loop', 'muted', 'preload', 'controlslist', 'width', 'height', 'playsinline']),
  track: new Set(['src', 'kind', 'srclang', 'label', 'default']),
  li: new Set(['value']),
  ol: new Set(['start', 'reversed']),
  p: new Set(['align']),
  table: new Set(['width', 'height', 'align', 'border', 'cellpadding', 'cellspacing', 'summary']),
  col: new Set(['span', 'width', 'align']), colgroup: new Set(['span', 'width', 'align']),
  tr: new Set(['align', 'valign']), thead: new Set(['align', 'valign']), tbody: new Set(['align', 'valign']), tfoot: new Set(['align', 'valign']),
  td: new Set(['colspan', 'rowspan', 'headers', 'align', 'valign', 'width', 'height', 'nowrap']),
  th: new Set(['colspan', 'rowspan', 'scope', 'headers', 'abbr', 'align', 'valign', 'width', 'height', 'nowrap']),
  label: new Set(['for']), fieldset: new Set(['disabled', 'name']),
  input: new Set(['type', 'name', 'value', 'checked', 'disabled', 'readonly', 'placeholder', 'size', 'min', 'max', 'step', 'minlength', 'maxlength', 'multiple', 'required', 'pattern', 'list', 'autocomplete']),
  button: new Set(['type', 'name', 'value', 'disabled']),
  select: new Set(['name', 'disabled', 'multiple', 'size', 'required']),
  option: new Set(['value', 'label', 'selected', 'disabled']), optgroup: new Set(['label', 'disabled']),
  textarea: new Set(['name', 'rows', 'cols', 'disabled', 'readonly', 'placeholder', 'minlength', 'maxlength', 'wrap', 'required']),
  output: new Set(['for', 'name']), progress: new Set(['value', 'max']), meter: new Set(['value', 'min', 'max', 'low', 'high', 'optimum']),
  style: new Set(['media', 'type'])
};

const svgAttributes = new Set('xmlns xmlns:xlink viewbox preserveaspectratio x y x1 y1 x2 y2 cx cy r rx ry width height d points dx dy rotate textlength lengthadjust fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity transform href xlink:href offset stop-color stop-opacity gradientunits gradienttransform spreadmethod patternunits patterncontentunits patterntransform markerwidth markerheight markerunits refx refy orient clippathunits clip-path mask maskunits maskcontentunits font-family font-size font-weight text-anchor dominant-baseline'.split(' '));
const mathAttributes = new Set('xmlns display mathvariant mathsize mathcolor mathbackground stretchy fence separator form accent accentunder lspace rspace largeop movablelimits symmetric maxsize minsize linethickness bevelled notation columnalign rowalign columnspacing rowspacing columnspan rowspan encoding'.split(' '));
const reservedAttribute = /^(?:data-(?:meo-|source-|line(?:$|-))|(?:nonce|contenteditable|autofocus)$)/i;

export function isSupportedHtmlAttribute(tagName: string, attributeName: string): boolean {
  const normalizedAttribute = attributeName.toLowerCase();
  if (normalizedAttribute.startsWith('on') || reservedAttribute.test(normalizedAttribute)) {
    return false;
  }
  return globalAttributes.has(normalizedAttribute) || /^(?:aria|data)-[a-z][\w.-]*$/.test(normalizedAttribute) ||
    svgHtmlTags.includes(tagName.toLowerCase()) && svgAttributes.has(normalizedAttribute) ||
    mathHtmlTags.includes(tagName.toLowerCase()) && mathAttributes.has(normalizedAttribute) ||
    attributesByTag[tagName.toLowerCase()]?.has(normalizedAttribute) === true;
}

export { inspectHtmlStyle, sanitizeHtmlStyle, sanitizeHtmlStylesheet, htmlSanitizedStyleRules } from './htmlStyle';
export type { HtmlStyleInspection } from './htmlStyle';

export function getSupportedHtmlAttributes(tagName: string): string[] {
  return [...globalAttributes, 'aria-*', 'data-*', ...(attributesByTag[tagName.toLowerCase()] ?? []),
    ...(svgHtmlTags.includes(tagName.toLowerCase()) ? [...svgAttributes].map(canonicalHtmlAttributeName) : []),
    ...(mathHtmlTags.includes(tagName.toLowerCase()) ? mathAttributes : [])];
}

export function isHtmlUrlAttribute(name: string): boolean {
  return ['href', 'src', 'poster', 'cite', 'xlink:href'].includes(name.toLowerCase());
}

export function normalizeHtmlAlign(value: string | null): 'left' | 'center' | 'right' | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'left' || normalized === 'center' || normalized === 'right'
    ? normalized
    : null;
}

export function isSafeHtmlUrl(value: string, kind: 'href' | 'src'): boolean {
  const normalized = normalizeLinkDestination(value).replace(/[\u0000-\u0020\u007f]/g, '');
  if (!normalized) return false;
  if (normalized.startsWith('#')) return kind === 'href';
  if (/^(?:\.\.?\/|\/)/.test(normalized)) return true;

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (kind === 'href') {
    return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ||
      scheme === 'tel' || scheme === 'file';
  }
  return scheme === 'http' || scheme === 'https' || scheme === 'file' ||
    (scheme === 'data' && /^data:(?:image\/(?:png|gif|jpe?g|webp|avif|bmp|svg\+xml)|audio\/[\w.+-]+|video\/[\w.+-]+|text\/vtt);/i.test(normalized));
}

/** A data URL's comma belongs to the URL. Descriptors remain browser-owned. */
export function mapHtmlSrcset(source: string, rewrite: (url: string) => string): string {
  const candidates: string[] = [];
  const pattern = /\s*((?:data:[^\s]+|[^\s,]+))(?:\s+((?:\d+(?:\.\d+)?x|\d+w)))?\s*(?:,|$)/gy;
  let cursor = 0;
  while (cursor < source.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match || match.index !== cursor) return '';
    const url = match[1]!.replace(/,$/, '');
    if (!isSafeHtmlUrl(url, 'src')) return '';
    const mapped = rewrite(url);
    if (mapped) candidates.push(mapped + (match[2] ? ` ${match[2]}` : ''));
    cursor = pattern.lastIndex;
  }
  return candidates.join(', ');
}

export function normalizeHtmlAttribute(tag: string, name: string, value: string): string | null {
  name = name.toLowerCase();
  if (!isSupportedHtmlAttribute(tag, name)) return null;
  if (isHtmlUrlAttribute(name)) value = normalizeLinkDestination(value);
  if (isHtmlUrlAttribute(name) && !isSafeHtmlUrl(value, name === 'href' || name === 'cite' || name === 'xlink:href' ? 'href' : 'src')) return null;
  if (name === 'srcset') return mapHtmlSrcset(value, url => url) || null;
  if (name === 'class') return value.split(/\s+/).filter(className => !/^(?:meo-|cm-|katex|hljs)/i.test(className)).join(' ');
  if (name === 'id' && /^(?:meo-|cm-)/i.test(value)) return null;
  if (svgHtmlTags.includes(tag.toLowerCase()) && /(?:url\s*\(|javascript:)/i.test(value)
    && !/^url\(\s*#[\w:.-]+\s*\)$/i.test(value)) return null;
  return value;
}

/** A paired HTML code element owns its Markdown characters as literal content. */
export function matchInlineHtmlCode(source: string, from: number, end = source.length): {
  from: number; contentFrom: number; contentTo: number; to: number;
} | null {
  if (source.slice(from, from + 5).toLowerCase() !== '<code') return null;
  const text = source.slice(from, end);
  const open = /^<code(?:\s+[a-zA-Z:_][\w-.:]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*>/i.exec(text);
  if (!open) return null;
  const closing = /<\/code\s*>/i.exec(text.slice(open[0].length));
  if (!closing) return null;
  const contentFrom = from + open[0].length;
  const contentTo = contentFrom + closing.index;
  return { from, contentFrom, contentTo, to: contentTo + closing[0].length };
}

export function getHtmlTagNames(source: string): string[] {
  return scanHtmlTags(source).map((tag) => tag.name);
}

/** Admit fragments with supported content. Renderers still sanitize attributes
 * and escape unknown tags individually; this is never a trusted-HTML check. */
export function isSupportedHtmlSource(source: string): boolean {
  if (/<!--[\s\S]*?-->|<!doctype\b|<\?/i.test(source)) return false;
  const names = getHtmlTagNames(source);
  return names.some((name) => supportedHtmlTags.has(name));
}

export function getHtmlRootTagName(source: string): string | null {
  return /^\s*<\s*([a-z][a-z\d-]*)\b/i.exec(source)?.[1]?.toLowerCase() ?? null;
}

export function isSupportedHtmlBlockSource(source: string): boolean {
  const root = getHtmlRootTagName(source);
  return root !== null && isSupportedHtmlSource(source);
}
