/** GFM splits rows before inline parsing; only an odd backslash run escapes a pipe. */
export function markdownTableSeparatorPipes(text: string): number[] {
  const pipes: number[] = [];
  let slashes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '|' && slashes % 2 === 0) pipes.push(index);
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  return pipes;
}

/** Retains encoded cell contents for source editing and subsequent inline parsing. */
export function splitMarkdownTableRow(line: string): string[] {
  const content = line.replace(/^\s*(?:>\s*)*/, '').trim();
  if (content === '|') return [];
  const pipes = markdownTableSeparatorPipes(content);
  const end = pipes.at(-1) === content.length - 1 ? content.length - 1 : content.length;
  const cells: string[] = [];
  let cursor = content.startsWith('|') ? 1 : 0;
  for (const pipe of pipes) {
    if (pipe < cursor || pipe >= end) continue;
    cells.push(content.slice(cursor, pipe).trim());
    cursor = pipe + 1;
  }
  cells.push(content.slice(cursor, end).trim());
  return cells;
}
