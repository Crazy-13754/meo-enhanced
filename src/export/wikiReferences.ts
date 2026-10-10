import type MarkdownIt from 'markdown-it';
import { isWikiImageTarget, parseWikiReference, wikiImageSrc, WIKI_LINK_SCHEME, type ResolvedWikiResources } from '../foundation/wikiReference';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/** Reading and export consume the same resolved files that the editor uses. */
export function installWikiReferenceTransform(md: MarkdownIt, preview: boolean, resources?: ResolvedWikiResources): void {
  md.inline.ruler.before('link', 'meo_wiki_reference', (state, silent) => {
    const reference = parseWikiReference(state.src, state.pos);
    if (!reference || reference.to > state.posMax || (reference.embed && !isWikiImageTarget(reference.target))) return false;
    if (!silent) {
      const resource = resources && Object.hasOwn(resources, reference.target) ? resources[reference.target] : undefined;
      if (resource && !resource.uri) {
        const missing = state.push('html_inline', '', 0);
        missing.content = `<span class="meo-wiki-missing" title="${escape(resource.issue ?? 'Wiki target not found')}">${escape(reference.label)}</span>`;
      } else if (reference.embed) {
        const image = state.push('image', 'img', 0);
        image.attrSet('src', preview ? wikiImageSrc(reference.target) : resource?.uri ?? reference.target);
        image.attrSet('alt', reference.label);
        if (reference.width) image.attrSet('width', String(reference.width));
        if (reference.height) image.attrSet('height', String(reference.height));
        if (reference.width) image.attrSet('style', `width: ${reference.width}px${reference.height ? `; height: ${reference.height}px` : ''}`);
        const label = new state.Token('text', '', 0);
        label.content = reference.label;
        image.children = [label];
      } else {
        const external = /^[a-z][a-z0-9+.-]*:/i.test(reference.target) && !/^[a-z]:[\\/]/i.test(reference.target);
        const href = external ? reference.target : preview
          ? `${WIKI_LINK_SCHEME}${encodeURIComponent(reference.target)}` : resource?.uri ?? reference.target;
        state.push('link_open', 'a', 1).attrSet('href', href);
        state.push('text', '', 0).content = reference.label;
        state.push('link_close', 'a', -1);
      }
    }
    state.pos = reference.to;
    return true;
  });
}
