/** Container prefixes belong to Markdown, not to the nested source document. */
export function applySourceLinePrefix(sourceText: string, prefix: string): string {
  return prefix ? sourceText.split('\n').map(line => prefix + line).join('\n') : sourceText;
}

export function outerOffsetToSourceOffset(sourceText: string, prefix: string, offset: number): number {
  if (!prefix) return Math.max(0, Math.min(offset, sourceText.length));
  const target = Math.max(0, offset);
  const lines = sourceText.split('\n');
  let outerPosition = 0, sourcePosition = 0;
  for (const [index, line] of lines.entries()) {
    const outerLineEnd = outerPosition + prefix.length + line.length;
    if (target <= outerLineEnd) return sourcePosition + Math.max(0, Math.min(line.length, target - outerPosition - prefix.length));
    outerPosition = outerLineEnd;
    sourcePosition += line.length;
    if (index < lines.length - 1) { outerPosition++; sourcePosition++; }
  }
  return sourceText.length;
}

export function sourceOffsetToOuterOffset(sourceText: string, prefix: string, offset: number): number {
  if (!prefix) return Math.max(0, Math.min(offset, sourceText.length));
  const target = Math.max(0, Math.min(offset, sourceText.length));
  const lines = sourceText.split('\n');
  let outerPosition = 0, sourcePosition = 0;
  for (const [index, line] of lines.entries()) {
    const sourceLineEnd = sourcePosition + line.length;
    if (target <= sourceLineEnd) return outerPosition + prefix.length + target - sourcePosition;
    outerPosition += prefix.length + line.length;
    sourcePosition = sourceLineEnd;
    if (index < lines.length - 1) { outerPosition++; sourcePosition++; }
  }
  return outerPosition;
}
