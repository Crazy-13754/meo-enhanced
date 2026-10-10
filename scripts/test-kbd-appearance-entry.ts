import { createEditor } from './test-editor-factory';
import { applyBuiltInVisualBaseline } from '../webview/src/helpers/theme';

(globalThis as typeof globalThis & {
  KbdAppearanceHarness?: {
    createEditor: typeof createEditor;
    applyBuiltInVisualBaseline: typeof applyBuiltInVisualBaseline;
  };
}).KbdAppearanceHarness = { createEditor, applyBuiltInVisualBaseline };
