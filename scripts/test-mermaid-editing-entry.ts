import { createEditor, refreshMermaidTheme } from './test-editor-factory';
import { editorViewportBounds } from '../webview/src/editor/editorViewportBounds';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import { setShikiTheme, type RawVscodeTheme } from '../webview/src/helpers/shikiHighlighter';
import { applyUiTheme } from '../webview/src/helpers/uiTheme';
import { createMermaidToolbarWidget } from '../webview/src/helpers/mermaidEditing';

function applyCodeTheme(appearance: 'light' | 'dark'): void {
  const theme = (appearance === 'light' ? lightPlus : darkPlus) as RawVscodeTheme;
  setShikiTheme(theme);
  setShikiTheme(theme, 'source');
}

(globalThis as typeof globalThis & {
  MermaidEditingHarness?: {
    createEditor: typeof createEditor;
    refreshMermaidTheme: typeof refreshMermaidTheme;
    applyCodeTheme: typeof applyCodeTheme;
    editorViewportBounds: typeof editorViewportBounds;
    applyUiTheme: typeof applyUiTheme;
    createMermaidToolbarWidget: typeof createMermaidToolbarWidget;
  };
}).MermaidEditingHarness = { createEditor, refreshMermaidTheme, applyCodeTheme, editorViewportBounds, applyUiTheme, createMermaidToolbarWidget };
