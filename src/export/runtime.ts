import { renderMarkdownToHtml } from './renderMarkdown';
import { buildExportHtmlDocument as buildStandaloneExportHtmlDocument } from './exportHtmlTemplate';
import { buildExportStyles, type ExportStyleEnvironment } from './exportStyles';
import { writeHtmlExport } from './htmlExport';
import { renderPdfFromHtmlExport } from './pdfRenderer';
import { writeDocxExport } from './docxRenderer';
import type { PreviewAppearance, PreviewRenderResult } from '../shared/preview';
import type { ReadingSnapshot } from '../protocol/exportSnapshot';
import type { CodeThemeDto } from '../protocol/hostConfigurationEvents';
import { createExportCodeHighlighter } from './shikiCodeHighlighter';
import { resolvePreviewPresetSettings, type PreviewPresetId, type PreviewContentWidth } from '../foundation/previewPresets';
import { buildPresetPreviewStyles } from '../preview/presetStyles';

export type ExportRuntimeBuildHtmlOptions = {
  readingSnapshot: ReadingSnapshot;
  sourceDocumentPath: string;
  outputFilePath: string;
  target: 'html' | 'pdf' | 'docx';
  mermaidRuntimeSrc: string;
  katexStylesHref?: string;
  baseHref: string;
  title: string;
  includeTableOfContents?: boolean;
  shikiLanguageAssetsRoot: string;
};

async function renderExportHtmlDocument(
  options: ExportRuntimeBuildHtmlOptions
): Promise<{ htmlDocument: string; hasMermaid: boolean; hasMath: boolean }> {
  const snapshot = options.readingSnapshot;
  const preset = options.target === 'docx' ? 'default' : snapshot.preset ?? 'default';
  const githubStyle = preset === 'github-readme';
  const exportAppearance = githubStyle ? snapshot.appearance : 'light';
  const environment = githubStyle
    ? { ...snapshot.environment, ...resolvePreviewPresetSettings(preset, snapshot.environment) }
    : snapshot.environment;
  const fallbackTheme = githubStyle
    ? (exportAppearance === 'light'
      ? (await import('@shikijs/themes/github-light-default')).default
      : (await import('@shikijs/themes/github-dark-default')).default) as CodeThemeDto
    : options.target === 'docx' || !snapshot.codeTheme
    ? (await import('@shikijs/themes/light-plus')).default as CodeThemeDto
    : snapshot.codeTheme;
  const highlighter = environment.previewSourceColoring === false
    ? null
    : await createExportCodeHighlighter(snapshot.text, fallbackTheme, options.shikiLanguageAssetsRoot, !githubStyle);
  let rendered: ReturnType<typeof renderMarkdownToHtml>;
  try {
    rendered = renderMarkdownToHtml({
      markdownText: snapshot.text,
      markdownFilePath: options.sourceDocumentPath,
      outputFilePath: options.outputFilePath,
      target: options.target,
      uiLanguage: snapshot.uiLanguage,
      showComments: environment.previewShowComments === true,
      preset,
      includeTableOfContents: options.target !== 'docx' && options.includeTableOfContents === true,
      ...(highlighter ? { highlightCode: highlighter.highlight } : {})
    });
  } finally {
    highlighter?.dispose();
  }
  const { html: bodyHtml, hasMermaid, hasMath } = rendered;

  const stylesCss = githubStyle
    ? buildPresetPreviewStyles(preset, environment, exportAppearance)
    : buildExportStyles(environment, exportAppearance);

  const htmlDocument = buildStandaloneExportHtmlDocument({
    title: options.title,
    bodyHtml,
    stylesCss,
    target: options.target,
    githubStyle,
    hasMermaid,
    hasMath,
    mermaidRuntimeSrc: options.mermaidRuntimeSrc,
    katexStylesHref: options.katexStylesHref,
    baseHref: options.baseHref
  });

  return { htmlDocument, hasMermaid, hasMath };
}

function renderPreviewDocument(options: {
  markdownText: string;
  sourceDocumentPath: string;
  uiLanguage: ReadingSnapshot['uiLanguage'];
  styleEnvironment?: ExportStyleEnvironment;
  preset?: PreviewPresetId;
  contentWidth?: PreviewContentWidth;
}): PreviewRenderResult {
  const preset = options.preset ?? 'default';
  const environment = {
    ...options.styleEnvironment,
    ...resolvePreviewPresetSettings(preset, options.styleEnvironment ?? { previewFontFamily: '' })
  };
  const rendered = renderMarkdownToHtml({
    markdownText: options.markdownText,
    markdownFilePath: options.sourceDocumentPath,
    target: 'html',
    uiLanguage: options.uiLanguage,
    showComments: environment.previewShowComments === true,
    deferImages: true,
    preset
  });
  return {
    html: rendered.html,
    hasMermaid: rendered.hasMermaid,
    preset,
    styles: {
      dark: buildPresetPreviewStyles(preset, environment, 'dark', options.contentWidth),
      light: buildPresetPreviewStyles(preset, environment, 'light', options.contentWidth)
    }
  };
}

const exportRuntime = {
  renderExportHtmlDocument,
  renderPreviewDocument,
  writeHtmlExport,
  renderPdfFromHtmlExport,
  writeDocxExport
};

export default exportRuntime;
export type { ExportStyleEnvironment };
