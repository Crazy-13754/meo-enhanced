import { Facet, type EditorState } from '@codemirror/state';
import type { SourceLineNumberMode } from '../../../src/protocol/readyInit';

export const sourceLineNumberModeFacet = Facet.define<SourceLineNumberMode, SourceLineNumberMode>({
  combine: values => values[0] ?? 'on'
});

/** Widgets and native document lines must use the same numbering rule. */
export function formatSourceLineNumber(line: number, state: EditorState): string {
  const mode = state.facet(sourceLineNumberModeFacet);
  const current = state.doc.lineAt(state.selection.main.head).number;
  if (mode === 'off') return '';
  if (mode === 'relative') return String(line === current ? line : Math.abs(line - current));
  if (mode === 'interval') return line === current || line % 10 === 0 ? String(line) : '';
  return String(line);
}
