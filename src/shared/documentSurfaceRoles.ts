/** Final document colors travel through the existing style environment. They
 * are projections of the eight inputs, never additional settings or defaults. */
export const documentSurfaceVariables = {
  '--meo-code-bg': 'block',
  '--meo-inline-code-bg': 'inline',
  '--meo-inline-code-border': 'inline-border',
  '--meo-frontmatter-bg': 'block',
  '--meo-frontmatter-border': 'block-border',
  '--meo-frontmatter-key-bg': 'block-hover',
  '--meo-frontmatter-pill-bg': 'inline',
  '--meo-table-header-bg': 'table',
  '--meo-table-row-bg': 'table',
  '--meo-table-border': 'separator',
  '--meo-quote-border': 'separator',
  '--meo-hr': 'separator',
  '--meo-kbd-border': 'separator',
  '--meo-kbd-shadow': 'separator',
  '--meo-code-border': 'separator',
  '--meo-preview-code-copy-fg': 'action-text',
  '--meo-preview-code-copy-hover-fg': 'action-hover-text',
  '--meo-preview-code-copy-hover-bg': 'block-hover'
} as const;
