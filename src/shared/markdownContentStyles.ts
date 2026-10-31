// Default dark emphasis adds brightness; optional semantic coloring owns its separate palette.
export const darkDefaultStrongForeground = 'color-mix(in srgb, currentColor 70%, #fff 30%)';
export const darkDefaultLiveStrongForeground = 'color-mix(in srgb, currentColor 40%, #fff 60%)';

/** Shared content styles. Surface adapters supply selectors, never independent style values. */
export const markdownContentStyles = {
  emphasis: { fontStyle: 'italic' },
  strong: { fontWeight: '700' },
  strikethrough: { textDecoration: 'line-through' },
  subscript: { fontSize: '0.75em', lineHeight: '0', verticalAlign: 'sub' },
  superscript: { fontSize: '0.75em', lineHeight: '0', verticalAlign: 'super' },
  underline: { textDecoration: 'underline' },
  highlight: {
    color: 'inherit', backgroundColor: 'var(--meo-content-highlight, color-mix(in srgb, #ffd60a 34%, transparent))',
    borderRadius: '0.14em', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'
  },
  inlineCode: {
    fontFamily: 'var(--meo-content-code-font)', fontWeight: 'var(--meo-content-code-weight, inherit)',
    fontSize: '1em', lineHeight: 'inherit', fontStyle: 'inherit', textDecoration: 'inherit',
    padding: '0.08em 0.25em', borderRadius: '0.35em',
    background: 'var(--meo-content-code-background)',
    WebkitTextFillColor: 'currentColor',
    boxShadow: 'inset 0 0 0 1px var(--meo-content-code-border, transparent)',
    boxDecorationBreak: 'slice', WebkitBoxDecorationBreak: 'slice'
  },
  paragraph: { margin: '0 0 1em' },
  blockquote: {
    borderLeft: '3px solid var(--meo-content-quote-border)',
    color: 'var(--meo-content-quote-foreground)', background: 'transparent', borderRadius: '0'
  }
} as const;

type ContentStyleSelectors = Readonly<Partial<Record<keyof typeof markdownContentStyles, string>>>;

export function contentStyleDeclarations(style: Readonly<Record<string, string>>): string {
  return Object.entries(style).map(([property, value]) => (
    `${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${value};`
  )).join(' ');
}

export function buildMarkdownContentStyleCss(selectors: ContentStyleSelectors): string {
  return (Object.keys(selectors) as Array<keyof typeof markdownContentStyles>).map((kind) => {
    return `${selectors[kind]} { ${contentStyleDeclarations(markdownContentStyles[kind])} }`;
  }).join('\n');
}

export function markdownHeadingStyle(level: number) {
  return { fontSize: `var(--meo-heading-${level}-size)`,
    fontWeight: `var(--meo-content-heading-weight, var(--meo-heading-${level}-weight))`,
    color: 'var(--meo-content-heading-foreground)' };
}
