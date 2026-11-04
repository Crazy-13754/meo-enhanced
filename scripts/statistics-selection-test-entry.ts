import { createEditor } from './test-editor-factory';
import { createDocumentStatisticsReporter } from '../webview/src/adapters/documentStatistics';
import { readDocumentTextProjection } from '../webview/src/application/documentTextProjection';

const scope = window as any;
scope.mountStatistics = (text: string) => {
  scope.editor?.destroy(); scope.reporter?.dispose();
  scope.statistics = null;
  let reporter: ReturnType<typeof createDocumentStatisticsReporter> | undefined;
  const editor = scope.editor = createEditor({ parent: document.querySelector('#app')!, text, initialMode: 'live',
    onApplyChanges() {}, onStatisticsChange: () => reporter?.schedule() });
  reporter = scope.reporter = createDocumentStatisticsReporter(() => ({ text: readDocumentTextProjection(editor.view.state.doc),
    ...editor.readStatisticsSelection() }), message => {
    scope.statistics = message.statistics;
  });
  reporter.schedule();
};
