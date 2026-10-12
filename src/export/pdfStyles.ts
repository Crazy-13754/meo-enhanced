export const DEFAULT_PDF_MARGIN_MM = 20;

/** A fallback layer lets explicit user @page margins win, including other layered CSS. */
export function buildPdfExportStyles(presetStyles: string): string {
  return `@layer meo-pdf-default { @page { size: A4; margin: ${DEFAULT_PDF_MARGIN_MM}mm; } }
${presetStyles}
/* Screen document padding must not add a second set of PDF page margins. */
html[data-meo-export-target='pdf'] .meo-export-page,
html[data-meo-export-target='pdf'] .meo-export-doc {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
}
`;
}
