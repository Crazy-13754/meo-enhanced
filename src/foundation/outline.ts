export interface OutlineHeading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

/** Heading paths follow document order and remain stable when source lines move. */
export function outlineHeadingKeys(headings: readonly Pick<OutlineHeading, 'level' | 'text'>[]): string[] {
  const stack: { level: number; key: string }[] = [];
  const occurrences = new Map<string, number>();
  return headings.map(heading => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const base = `${stack.at(-1)?.key ?? 'root'}/h${heading.level}:${heading.text.trim().toLowerCase()}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const key = `${base}:${occurrence}`;
    stack.push({ level: heading.level, key });
    return key;
  });
}

/** Last heading at or before the anchor, using sorted source offsets or lines. */
export function findOutlineHeadingIndex(starts: readonly number[], anchor: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= anchor) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Match the in-editor outline's visible heading / four visible section lines rule. */
export function visibleOutlineHeadingIndexes(
  headings: readonly OutlineHeading[],
  lines: readonly number[],
  range: { readonly fromLine: number; readonly toLine: number } | null
): number[] {
  if (!range) return [];
  const first = Math.max(0, findOutlineHeadingIndex(lines, range.fromLine));
  const last = findOutlineHeadingIndex(lines, range.toLine);
  const visible: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const heading = headings[index];
    const sectionLastLine = (headings[index + 1]?.line ?? Infinity) - 1;
    const visibleLines = Math.min(sectionLastLine, range.toLine) - Math.max(heading.line, range.fromLine) + 1;
    if (heading.line >= range.fromLine || visibleLines >= 4) visible.push(index);
  }
  return visible;
}
