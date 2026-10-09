// Bun embeds these pinned CSS assets in the export runtime, so Preview works offline.
import light from './github-markdown-light.css' with { type: 'text' };
import dark from './github-markdown-dark.css' with { type: 'text' };

export function getGithubMarkdownStyles(appearance) {
  return appearance === 'light' ? light : dark;
}
