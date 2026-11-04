export type DocumentStatistics = {
  readonly words: number;
  readonly selectedWords: number;
  readonly hasSelection: boolean;
  readonly lines: number;
  readonly line: number | null;
  readonly characters: number;
};
export type DocumentStatisticsMessage = {
  readonly type: 'documentStatistics';
  readonly statistics: DocumentStatistics | null;
};
export function decodeDocumentStatistics(value: unknown): DocumentStatisticsMessage | null {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'documentStatistics'
    || !('statistics' in value)) return null;
  const s = value.statistics;
  if (s === null) return { type: 'documentStatistics', statistics: null };
  if (!s || typeof s !== 'object') return null;
  const data = s as Record<string, unknown>;
  for (const key of ['words', 'selectedWords', 'lines', 'characters']) {
    if (!Number.isSafeInteger(data[key]) || (data[key] as number) < 0) return null;
  }
  if ((data.lines as number) < 1 || (data.selectedWords as number) > (data.words as number)
    || typeof data.hasSelection !== 'boolean'
    || !(data.line === null || Number.isSafeInteger(data.line) && (data.line as number) >= 1 && (data.line as number) <= (data.lines as number))) return null;
  return { type: 'documentStatistics', statistics: s as DocumentStatistics };
}
