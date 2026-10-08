import type { DelimiterType, MarkdownConfig, MarkdownParser } from '@lezer/markdown';
import { inlineStyleDelimiter } from '../../../src/shared/punctuationInlineStyles';

function nativeDelimiter(parser: MarkdownParser, marker: string): DelimiterType {
  let type: DelimiterType | undefined;
  // The public context API exposes delimiter identities. Preserve the native
  // emphasis resolver (including split runs and the rule of three) without
  // copying its implementation or reading private parser fields.
  parser.configure({ parseInline: [{
    name: 'ReadStyleDelimiter', before: 'Escape',
    parse(context, _next, pos) {
      if (pos === marker.length) type = context.getDelimiterAt(0)?.type;
      return -1;
    }
  }] }).parseInline(`${marker}x`, 0);
  if (!type?.resolve) throw new Error(`Missing native Markdown delimiter: ${marker}`);
  return type;
}

export function createPunctuationInlineStyleExtension(parser: MarkdownParser): MarkdownConfig {
  const emphasis = nativeDelimiter(parser, '*');
  const strike = nativeDelimiter(parser, '~~');
  return { parseInline: [{
    name: 'PunctuationStyle', before: 'Emphasis',
    parse(context, next, pos) {
      if (next !== 42 && next !== 126) return -1;
      const delimiter = inlineStyleDelimiter(context.text, pos - context.offset);
      if (!delimiter) return -1;
      return context.addDelimiter(delimiter.marker === '*' ? emphasis : strike,
        pos, pos + delimiter.length, delimiter.canOpen, delimiter.canClose);
    }
  }] };
}
