import { EditorSelection } from '@codemirror/state';
import { assessLargeDocument } from '../src/foundation/largeDocument';
import { usesLargeDocumentDerivedWorkBudget } from '../webview/src/editor/liveInputDerivedWork';
import { createEditor } from './test-editor-factory';

Object.assign(window, {
  __createWordEditor: createEditor,
  __wordSelection: EditorSelection,
  __wordAssessment: assessLargeDocument,
  __wordOptimized: usesLargeDocumentDerivedWorkBudget,
  __observeWordSegmentation() {
    const prototype = Intl.Segmenter.prototype, original = prototype.segment;
    let lengths: number[] = [];
    prototype.segment = function(input: string) {
      lengths.push(input.length);
      return original.call(this, input);
    };
    return {
      take() { const result = lengths; lengths = []; return result; },
      restore() { prototype.segment = original; }
    };
  }
});
