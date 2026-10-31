import { createMarkdownContentParser } from './markdownContentParser';

// HTML blocks keep CommonMark's raw boundaries; inline HTML participates in the
// same text styles as ordinary prose. The caller sanitizes the generated HTML.
const markdown = createMarkdownContentParser();

export function renderHtmlMarkdown(source: string, inline = false): string {
  return inline ? markdown.renderInline(source) : markdown.render(source);
}
