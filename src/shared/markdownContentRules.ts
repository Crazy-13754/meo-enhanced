/** Project Markdown semantics, independent of parser tokens and presentation. */
export function markdownOrderedListMarker(text: string) {
  const match = /^(\d{1,9})[.)](?:[ \t]+(.*)|$)/.exec(text);
  return match ? { number: Number(match[1]), hasContent: /[^ \t]/.test(match[2] ?? '') } : null;
}

export function orderedListInterruptsParagraph(text: string, containerEnded: boolean): boolean {
  const marker = markdownOrderedListMarker(text);
  return Boolean(marker && (containerEnded || marker.number === 1 && marker.hasContent));
}

export function isMarkdownTableDelimiter(text: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(text);
}

/** A bare thematic underline belongs to headings/rules, never loose-table repair. */
export function canRepairMarkdownTableDelimiter(text: string): boolean {
  return text.includes('|') && isMarkdownTableDelimiter(text);
}

/** Compare already-consumed container prefixes, leaving ordinary lazy prose
 * intact. Quote spacing may vary; list indentation still has to be present. */
export function markdownContainerHasEnded(first: string, next: string, quotes: number, lists: number): boolean {
  const initial = first.split('>'), current = next.split('>');
  if (current.length - 1 < quotes) return true;
  if (!lists) return false;
  const explicitLists = (first.match(/(?:[-+*]|\d{1,9}[.)])[ \t]+/g) ?? []).length;
  const columns = (text: string) => [...text].reduce((column, char) => char === '\t' ? column + 4 - column % 4 : column + 1, 0);
  return initial.some((segment, index) => {
    // The first space/tab after > belongs to the quote marker.
    const body = index ? segment.replace(/^[ \t]/, '') : segment;
    const following = index ? (current[index] ?? '').replace(/^[ \t]/, '') : current[index] ?? '';
    const needsIndent = explicitLists < lists || /(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(body);
    return needsIndent && columns(following) < columns(body);
  });
}
