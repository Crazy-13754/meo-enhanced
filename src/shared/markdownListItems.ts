import { createMarkdownContentParser } from './markdownContentParser';
import { markdownTaskMarkerPattern } from '../foundation/markdownTaskList';
import type { MarkdownListItem } from '../foundation/workspaceDocument';

const parser = createMarkdownContentParser();
const taskPrefix = new RegExp(`^${markdownTaskMarkerPattern}\\s+`);
/** Uses the same reading grammar. Fences, HTML and frontmatter are not task lists. */
export function readMarkdownListItems(text: string): readonly MarkdownListItem[] {
  text = text.replace(/\r\n?/g, '\n');
  const frontmatter = /^\uFEFF?---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(text);
  const source = frontmatter ? frontmatter[0].replace(/[^\n]/g, ' ') + text.slice(frontmatter[0].length) : text;
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offsets.push(i + 1);
  const items: MarkdownListItem[] = [], stack: { handled: boolean }[] = [];
  const headings: { level: number; text: string }[] = [];
  let headingLevel = 0;
  for (const token of parser.parse(source, {})) {
    if (token.type === 'heading_open') headingLevel = Number(token.tag.slice(1));
    else if (token.type === 'heading_close') headingLevel = 0;
    else if (token.type === 'list_item_open') stack.push({ handled: false });
    else if (token.type === 'list_item_close') stack.pop();
    else if (token.type === 'inline') {
      const plain = (token.children ?? []).map(child => ['text','code_inline','image'].includes(child.type) ? child.content : ['softbreak','hardbreak'].includes(child.type) ? ' ' : '').join('');
      if (headingLevel) {
        while (headings.length && headings.at(-1)!.level >= headingLevel) headings.pop();
        headings.push({ level: headingLevel, text: plain });
      }
      const item = stack.at(-1);
      if (!item || item.handled || !token.map) continue;
      item.handled = true;
      const line = token.map[0], match = taskPrefix.exec(token.content);
      const first = token.content.split('\n', 1)[0]!;
      const start = offsets[line] ?? 0, end = offsets[line + 1] ?? text.length;
      const found = match ? text.indexOf(first, start) : -1;
      const task = match && found >= start && found < end
        ? { from: found + 1, marker: match[1] as ' ' | 'x' | 'X' } : undefined;
      items.push({ line: line + 1, heading: headings.map(h => h.text).join(' / '),
        text: match ? plain.replace(taskPrefix, '') : plain, ...(task ? { task } : {}) });
    }
  }
  return items;
}
