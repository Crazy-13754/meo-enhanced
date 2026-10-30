import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { createEditor } from './test-editor-factory';
import { installCausalFrameSettlement } from './causal-frame-settlement';
import { usesLargeDocumentDerivedWorkBudget } from '../webview/src/editor/liveInputDerivedWork';
import { applyBuiltInVisualBaseline } from '../webview/src/helpers/theme';
import {
  getTableTransactionProvenance
} from '../webview/src/adapters/tableTransactionProvenance';

(globalThis as typeof globalThis & {
  ListEditingHarness?: {
    createEditor: typeof createEditor;
    userEvent: typeof Transaction.userEvent;
    addToHistory: typeof Transaction.addToHistory;
    isolateHistory: typeof isolateHistory;
    getTableTransactionProvenance: typeof getTableTransactionProvenance;
    installCausalFrameSettlement: typeof installCausalFrameSettlement;
    usesLargeDocumentDerivedWorkBudget: typeof usesLargeDocumentDerivedWorkBudget;
    applyBuiltInVisualBaseline: typeof applyBuiltInVisualBaseline;
  };
}).ListEditingHarness = {
  createEditor,
  userEvent: Transaction.userEvent,
  addToHistory: Transaction.addToHistory,
  isolateHistory,
  getTableTransactionProvenance,
  installCausalFrameSettlement,
  usesLargeDocumentDerivedWorkBudget,
  applyBuiltInVisualBaseline
};
