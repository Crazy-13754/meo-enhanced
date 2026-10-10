import exportRuntime from '../src/export/runtime';

const baseOptions = {
  readingSnapshot: {
    snapshotId: 'appearance',
    text: '# Export appearance\n\n```mermaid\nflowchart LR\nA --> B\n```',
    appearance: 'light' as const,
    uiLanguage: 'en' as const,
    environment: {
      previewFontFamily: '',
      editorBackgroundColor: '#20252b',
      editorForegroundColor: '#d8dee9',
      codeBlockBackgroundColor: '#171b20',
      sideBarBackgroundColor: '#252b32',
      panelBorderColor: '#474b50'
    }
  },
  sourceDocumentPath: 'C:/tmp/source.md',
  outputFilePath: 'C:/tmp/export.html',
  target: 'html' as const,
  mermaidRuntimeSrc: 'mermaid.min.js',
  baseHref: 'file:///C:/tmp/',
  title: 'Export appearance'
};

const light = await exportRuntime.renderExportHtmlDocument(baseOptions);
const dark = await exportRuntime.renderExportHtmlDocument({
  ...baseOptions,
  readingSnapshot: { ...baseOptions.readingSnapshot, snapshotId: 'appearance-dark', appearance: 'dark' }
});
const darkPdf = await exportRuntime.renderExportHtmlDocument({
  ...baseOptions,
  target: 'pdf',
  outputFilePath: 'C:/tmp/export.pdf',
  readingSnapshot: { ...baseOptions.readingSnapshot, snapshotId: 'appearance-dark-pdf', appearance: 'dark' }
});

if (!light.htmlDocument.includes('--meo-bg: #ffffff')) {
  throw new Error('Light export did not build a white reading document');
}
if (!dark.htmlDocument.includes('--meo-bg: #20252b')) {
  throw new Error('Dark export did not preserve the actual Preview background');
}
if (!darkPdf.htmlDocument.includes('--meo-bg: #20252b')) {
  throw new Error('Dark PDF did not preserve the actual Preview background');
}
if (!light.hasMermaid || !dark.hasMermaid || light.htmlDocument === dark.htmlDocument) {
  throw new Error('Export did not follow the selected Preview appearance');
}

console.log('export appearance checks passed');
