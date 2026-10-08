import {
  scanLatexMath,
  scanLatexMathAt,
  type LatexMathMode,
  type LatexMathRange,
  type LatexMathScanOptions
} from '../shared/latexMathScanner';
import { renderMathToHtml } from '../shared/mathRenderer';

export type { LatexMathMode, LatexMathRange } from '../shared/latexMathScanner';

export function collectLatexMathRanges(text: string, options: LatexMathScanOptions = {}): LatexMathRange[] {
  return scanLatexMath(text, options);
}

export function parseLatexMathAt(text: string, from: number, options: LatexMathScanOptions = {}): LatexMathRange | null {
  return scanLatexMathAt(text, from, options);
}

export function renderLatexMathToHtml(content: string, mode: LatexMathMode): string | null {
  return renderMathToHtml(content, mode);
}
