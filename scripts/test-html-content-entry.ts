import { createEditor } from './test-editor-factory';
import { getLiveRenderedBlocks } from '../webview/src/helpers/liveRenderedBlocks';
import { bindTooltips } from '../webview/src/adapters/tooltip';
import { applyUiTheme } from '../webview/src/helpers/uiTheme';
import { handleEditorShortcut } from '../webview/src/helpers/shortcuts';
import { effectiveShortcuts } from '../src/application/editingPreferences';
import { usesLargeDocumentDerivedWorkBudget } from '../webview/src/editor/liveInputDerivedWork';
import { enterHtmlSource, getHtmlEditingRange } from '../webview/src/helpers/htmlContent';
import { setImageSrcResolver } from '../webview/src/helpers/images';
import { undo, redo } from '@codemirror/commands';
import { resolveHtmlResources } from '../webview/src/helpers/htmlResources';

(globalThis as typeof globalThis & {
  HtmlContentHarness?: {
    createEditor: typeof createEditor;
    getLiveRenderedBlocks: typeof getLiveRenderedBlocks;
    bindTooltips: typeof bindTooltips;
    applyUiTheme: typeof applyUiTheme;
    handleEditorShortcut: typeof handleEditorShortcut;
    effectiveShortcuts: typeof effectiveShortcuts;
    usesLargeDocumentDerivedWorkBudget: typeof usesLargeDocumentDerivedWorkBudget;
    enterHtmlSource: typeof enterHtmlSource;
    getHtmlEditingRange: typeof getHtmlEditingRange;
    setImageSrcResolver: typeof setImageSrcResolver;
    undo: typeof undo;
    redo: typeof redo;
    resolveHtmlResources: typeof resolveHtmlResources;
  };
}).HtmlContentHarness = { createEditor, getLiveRenderedBlocks, bindTooltips, applyUiTheme, handleEditorShortcut, effectiveShortcuts, usesLargeDocumentDerivedWorkBudget,
  enterHtmlSource, getHtmlEditingRange, setImageSrcResolver, undo, redo, resolveHtmlResources };
