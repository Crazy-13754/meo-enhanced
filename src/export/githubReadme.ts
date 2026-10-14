import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { Parser, parseDocument } from 'htmlparser2';
import emoji from '../preview/presets/github-readme/emoji.json';
import { normalizeLinkDestination, isLocalFileLinkDestination } from '../foundation/linkDestination';

// Calibrated against GitHub's README Preview, rather than html-pipeline's
// public default configuration (which permits a different set of elements).
export const githubHtmlTags = 'h1 h2 h3 h4 h5 h6 br b i strong em a pre code img tt div ins del sup sub p picture ol ul table thead tbody tfoot blockquote dl dt dd kbd q samp var hr ruby rt rp li tr td th s strike summary details source span mark section'.split(' ');
const globalAttributes = 'id name title dir lang align width height hspace valign colspan rowspan scope start value datetime open media alt tabindex abbr accept accept-charset accesskey action axis char charoff charset checked clear cols compact coords disabled enctype for frame headers hreflang ismap label maxlength method multiple nohref noshade nowrap prompt readonly rev rows rules selected shape size span summary type usemap itemprop'.split(' ');
export const githubHtmlAttributes: Record<string, string[]> = {
  '*': globalAttributes,
  a: ['href', 'aria-label'],
  img: ['src', 'longdesc', 'aria-label'],
  source: ['srcset'],
  div: ['itemscope', 'itemtype'],
  table: ['aria-label'],
  ol: ['aria-label'],
  blockquote: ['cite'], del: ['cite'], ins: ['cite'], q: ['cite']
};
const filteredTags = new Set('title textarea style xmp iframe noembed noframes script plaintext'.split(' '));
const voidTags = new Set(['br', 'hr', 'img', 'source']);
const rawTag = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[\s\S]*?(?:\?>|$)|<\/?[a-z][a-z\d-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;

/** Validate authored URLs before local resources become trusted data URLs. */
export function isGithubImageSource(source: string): boolean {
  const value = source.trim().replace(/[\u0000-\u0020\u007f]/g, '');
  return !value.startsWith('//') && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^https?:/i.test(value));
}

export function isGithubLink(href: string, allowLocalLinks = false): boolean {
  const value = normalizeLinkDestination(href).replace(/[\u0000-\u0020\u007f]/g, '');
  if (allowLocalLinks && isLocalFileLinkDestination(value)) return true;
  return !/^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:https?|mailto):/i.test(value);
}

export type GithubImageRewrite = (source: string) => { src: string; deferredSrc?: string };

export function createGithubHtmlSanitizer(rewriteImage: GithubImageRewrite, allowLocalLinks = false): {
  anchors: Set<string>;
  sanitize: (source: string) => string;
} {
  const anchors = new Set<string>();
  const allowed = new Set(githubHtmlTags);
  const options: NonNullable<Parameters<typeof sanitizeHtml>[1]> = {
    allowedTags: githubHtmlTags,
    allowedAttributes: githubHtmlAttributes,
    allowedSchemes: ['http', 'https', 'mailto', ...(allowLocalLinks ? ['file'] : [])],
    allowedSchemesByTag: { img: ['http', 'https', 'file', 'data'], srcset: ['http', 'https', 'file', 'data'] },
    allowProtocolRelative: true,
    transformTags: {
      '*': (tagName, attributes) => {
        const attribs = { ...attributes };
        delete attribs['data-meo-deferred-image-src'];
        delete attribs['data-meo-deferred-image-srcset'];
        for (const attribute of ['id', 'name']) {
          if (!(attribute in attribs)) continue;
          anchors.add(attribs[attribute]);
          attribs[attribute] = `user-content-${attribs[attribute]}`;
        }
        if (tagName === 'a' && attribs.href) {
          attribs.href = normalizeLinkDestination(attribs.href);
          if (!isGithubLink(attribs.href, allowLocalLinks)) delete attribs.href;
        }
        if (tagName === 'img' && attribs.src) {
          const rewritten = rewriteImage(attribs.src);
          attribs.src = rewritten.src;
          if (rewritten.deferredSrc) attribs['data-meo-deferred-image-src'] = rewritten.deferredSrc;
        }
        if (tagName === 'source' && attribs.srcset) {
          // GitHub picture sources accept a single URL, not density/width
          // candidate lists. Keep the same boundary before resolving locally.
          if (/\s|,/.test(attribs.srcset) || !isGithubImageSource(attribs.srcset)) {
            if (attribs.srcset.startsWith('//')) attribs.srcset = '';
            else delete attribs.srcset;
          } else {
            const rewritten = rewriteImage(attribs.srcset);
            attribs.srcset = rewritten.src;
            if (rewritten.deferredSrc) attribs['data-meo-deferred-image-srcset'] = rewritten.deferredSrc;
          }
        }
        return { tagName, attribs };
      }
    }
  };
  options.allowedAttributes = {
    ...githubHtmlAttributes,
    img: [...githubHtmlAttributes.img, 'data-meo-deferred-image-src'],
    source: [...githubHtmlAttributes.source, 'data-meo-deferred-image-srcset']
  };
  return {
    anchors,
    sanitize: (source) => source.replace(rawTag, (tag) => {
      const name = /^<\/?([a-z][a-z\d-]*)/i.exec(tag)?.[1].toLowerCase();
      if (!name) return '';
      if (filteredTags.has(name)) return `&lt;${tag.slice(1)}`;
      // Let the final document sanitizer discard video and its entire body,
      // including inline Markdown tokens between the opening/closing tags.
      if (name === 'video') return /^<\//.test(tag) ? '</video>' : '<video>';
      if (name === 'select') return /^<\//.test(tag) ? '</select>' : '<select>';
      if (!allowed.has(name)) return '';
      if (/^<\//.test(tag)) return `</${name}>`;
      const pair = sanitizeHtml(voidTags.has(name) ? tag : `${tag}</${name}>`, options);
      return new RegExp(`^<${name}\\b[^>]*>`, 'i').exec(pair)?.[0] ?? '';
    })
  };
}

/** GFM pairs one or two tildes; runs of three or more stay literal. */
export function installGithubInlineRules(md: MarkdownIt): void {
  const matchLinks = md.linkify.match.bind(md.linkify);
  md.linkify.match = (source) => matchLinks(source)?.filter(link => link.schema || /^www\./i.test(link.raw)) ?? null;
  // Parse even unsafe Markdown destinations, then remove the destination.
  // Rejecting during parsing would expose the original [label](URL) instead.
  md.validateLink = () => true;
  md.inline.ruler.at('strikethrough', (state, silent) => {
    if (silent || state.src[state.pos] !== '~') return false;
    const scanned = state.scanDelims(state.pos, true);
    const length = scanned.length;
    const inlineToken = state.push('text', '', 0);
    inlineToken.content = '~'.repeat(length);
    const delimiterToken = state.tokens.length - 1;
    if (length <= 2) state.delimiters.push({
      marker: length === 1 ? 0x7e : 0x7f, length: 0,
      token: delimiterToken,
      end: -1,
      open: scanned.can_open, close: scanned.can_close
    });
    state.pos += length;
    return true;
  });
  md.inline.ruler2.at('strikethrough', (state) => {
    const process = (delimiters: typeof state.delimiters) => {
      for (const start of delimiters) {
        if (![0x7e, 0x7f].includes(start.marker) || start.end === -1) continue;
        const end = delimiters[start.end];
        for (const [delimiter, opening] of [[start, true], [end, false]] as const) {
          const inlineToken = state.tokens[delimiter.token];
          inlineToken.type = opening ? 's_open' : 's_close';
          inlineToken.tag = 'del';
          inlineToken.nesting = opening ? 1 : -1;
          inlineToken.markup = start.marker === 0x7e ? '~' : '~~';
          inlineToken.content = '';
        }
      }
    };
    process(state.delimiters);
    for (const meta of state.tokens_meta) if (meta?.delimiters) process(meta.delimiters);
    return true;
  });
}

/** GitHub's emoji filter runs on text, excluding code and image attributes. */
export function replaceGithubEmoji(html: string, rewriteImage: GithubImageRewrite): string {
  const unicode: Record<string, string> = emoji.unicode;
  const custom: Record<string, string> = emoji.custom;
  let result = '', cursor = 0, excludedDepth = 0;
  const excludedStack: boolean[] = [];
  const parser = new Parser({
    onopentag: (name, attributes) => {
      const excluded = excludedDepth > 0 || name === 'code' || name === 'pre' || /\bmeo-export-math\b/.test(attributes.class ?? '');
      excludedStack.push(excluded);
      if (excluded) excludedDepth++;
    },
    onclosetag: () => { if (excludedStack.pop()) excludedDepth--; },
    ontext: (text) => {
      if (excludedDepth > 0) return;
      const converted = text.replace(/:([\w+-]+):/g, (source, name: string) => {
        if (Object.hasOwn(unicode, name)) return unicode[name];
        if (!Object.hasOwn(custom, name)) return source;
        const image = rewriteImage(custom[name]);
        return `<img class="emoji" title=":${name}:" alt=":${name}:" src="${image.src}"${image.deferredSrc ? ` data-meo-deferred-image-src="${image.deferredSrc}"` : ''} height="20" width="20" align="absmiddle">`;
      });
      result += html.slice(cursor, parser.startIndex) + converted;
      cursor = parser.endIndex + 1;
    }
  }, { decodeEntities: false });
  parser.end(html);
  return result + html.slice(cursor);
}

export function addGithubDetailsSummary(html: string): string {
  const insertions: number[] = [];
  const visit = (nodes: ReturnType<typeof parseDocument>['children']) => {
    for (const node of nodes) {
      if (!('children' in node)) continue;
      if ('name' in node && node.name === 'details' && node.startIndex !== null
        && !node.children.some(child => 'name' in child && child.name === 'summary')) {
        const opening = /^<details\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(html.slice(node.startIndex));
        if (opening) insertions.push(node.startIndex + opening[0].length);
      }
      visit(node.children);
    }
  };
  visit(parseDocument(html, { withStartIndices: true }).children);
  for (const index of insertions.sort((a, b) => b - a)) html = `${html.slice(0, index)}<summary>Details</summary>${html.slice(index)}`;
  return html;
}

export function stripGithubSelectMarkup(html: string): string {
  // Browser HTML parsing drops formatting inside select before GitHub removes
  // the select itself. Apply this after inline Markdown tokens are assembled.
  return html.replace(/<select>([\s\S]*?)<\/select>/gi, (_whole, content: string) => content.replace(rawTag, ''));
}

// README Preview autolinks URLs in the visible text produced by GFM tagfilter.
// It runs after HTML parsing; the Markdown API omits this extra README pass.
export function linkifyGithubFilteredHtml(html: string): string {
  const replacements: Array<{ from: number; to: number; text: string }> = [];
  const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const visit = (nodes: ReturnType<typeof parseDocument>['children'], excluded = false) => {
    for (const node of nodes) {
      if ('children' in node) {
        visit(node.children, excluded || ('name' in node && (['a', 'code', 'pre'].includes(node.name)
          || /\bmeo-export-math\b/.test(node.attribs.class ?? ''))));
      } else if (!excluded && node.type === 'text' && node.startIndex !== null && node.endIndex !== null
        && /<\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)\b/i.test(node.data)) {
        let cursor = 0, text = '';
        for (const match of node.data.matchAll(/https?:\/\/[^\s]+/g)) {
          text += escape(node.data.slice(cursor, match.index)) + `<a href="${escape(match[0])}">${escape(match[0])}</a>`;
          cursor = match.index + match[0].length;
        }
        if (cursor) replacements.push({ from: node.startIndex, to: node.endIndex + 1, text: text + escape(node.data.slice(cursor)) });
      }
    }
  };
  visit(parseDocument(html, { withStartIndices: true, withEndIndices: true }).children);
  for (const replacement of replacements.sort((a, b) => b.from - a.from)) {
    html = html.slice(0, replacement.from) + replacement.text + html.slice(replacement.to);
  }
  return html;
}
