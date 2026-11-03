import sanitizeHtml from 'sanitize-html';
import { renderMarkdownToHtml } from './renderMarkdown';
import { mathHtmlTags, getSupportedHtmlAttributes } from '../shared/htmlPolicy';

/** A restricted presentation of the reading renderer, not a second Markdown grammar.
 * No document paths, resource reads, author styles, navigation or interactive controls. */
export function renderDocumentContent(text: string): { html: string } {
  const rendered = renderMarkdownToHtml({ markdownText: text, markdownFilePath: '', target: 'html',
    preset: 'default', contentOnly: true, deferImages: true, deferLocalLinks: true, showComments: true });
  const html = sanitizeHtml(rendered.html, {
    allowedTags: ['h1','h2','h3','h4','h5','h6','p','div','span','strong','b','em','i','s','del','ins','u','sub','sup','mark',
      'br','hr','pre','code','kbd','blockquote','ul','ol','li','table','thead','tbody','tfoot','tr','th','td', ...mathHtmlTags],
    allowedAttributes: { '*': ['data-source-line','data-source-end-line','data-comment'], ol: ['start'],
      th: ['align','colspan','rowspan'], td: ['align','colspan','rowspan'],
      ...Object.fromEntries(mathHtmlTags.map(tag => [tag, getSupportedHtmlAttributes(tag).filter(attr => !['style','class','id'].includes(attr))])) },
    transformTags: {
      img: (_tag, attrs) => ({ tagName: 'span', attribs: {}, text: attrs.alt || 'Image' }),
      aside: (tag, attrs) => attrs.class?.split(' ').includes('meo-export-comment')
        ? { tagName: 'span', attribs: { 'data-comment': 'true' } } : { tagName: tag, attribs: attrs },
      span: (tag, attrs) => {
        const classes = (attrs.class ?? '').split(' ');
        if (classes.includes('meo-export-comment')) return { tagName: tag, attribs: { 'data-comment': 'true' } };
        if (classes.includes('meo-export-task-checkbox')) return { tagName: tag, attribs: {}, text: classes.includes('is-done') ? '☑ ' : '☐ ' };
        return { tagName: tag, attribs: attrs };
      },
      th: alignCell, td: alignCell
    }
  });
  return { html };
}
function alignCell(tagName: string, attribs: Record<string, string>) {
  const alignment = /(?:^|;)\s*text-align:\s*(left|center|right)\s*(?:;|$)/.exec(attribs.style ?? '')?.[1];
  return { tagName, attribs: { ...attribs, ...(alignment ? { align: alignment } : {}) } };
}
