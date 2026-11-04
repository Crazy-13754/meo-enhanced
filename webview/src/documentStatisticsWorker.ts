import { createDocumentStatisticsIndex, type StatisticsRequest } from './adapters/documentStatisticsIndex';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { MarkdownParser } from '@lezer/markdown';
import { inlineMarkdownExtensions } from './helpers/inlineMarkdownParser';
const grammar = (markdownLanguage.parser as MarkdownParser).configure(inlineMarkdownExtensions);
let index: ReturnType<typeof createDocumentStatisticsIndex> | undefined;
self.onmessage = ({ data }: MessageEvent<StatisticsRequest>) => {
  try {
    if (data.text !== undefined) index = createDocumentStatisticsIndex(data.text, grammar);
    self.postMessage({ id: data.id, statistics: index?.(data.selections, data.line, data.hasSelection) ?? null });
  } catch { self.postMessage({ id: data.id, statistics: null }); }
};
