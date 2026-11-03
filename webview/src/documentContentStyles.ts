import { buildMarkdownContentStyleCss } from '../../src/shared/markdownContentStyles';

/** Host owns ordinary content appearance; contributed canvases only constrain layout. */
const root = ':is(.mm-view-panel,.meo-contributed-canvas) .meo-document-content';
export const documentContentStyles = `
${root}{color:inherit;font:inherit;--meo-content-code-font:var(--meo-view-code-font-family);--meo-content-code-background:var(--meo-view-hover-background);--meo-content-quote-border:var(--meo-view-muted-foreground);--meo-content-quote-foreground:inherit;--meo-content-highlight:color-mix(in srgb,#ffd60a 34%,transparent)}
${buildMarkdownContentStyleCss({
  emphasis: `${root} :is(em,i)`, strong: `${root} :is(strong,b)`, strikethrough: `${root} :is(s,del)`,
  subscript: `${root} sub`, superscript: `${root} sup`, underline: `${root} :is(ins,u)`,
  highlight: `${root} mark`, inlineCode: `${root} code`, paragraph: `${root} p`, blockquote: `${root} blockquote`
})}
${root} p:last-child{margin-bottom:0}
${root} blockquote{margin:0 0 .5em;padding-left:.6em}
${root} blockquote>p{margin-bottom:.25em}
${root} blockquote>:last-child{margin-bottom:0}
${root} :is(ul,ol){margin:.25em 0;padding-left:1.4em}
${root} table{border-collapse:collapse;color:inherit}
${root} :is(th,td){padding:.15em .4em;vertical-align:top;border:1px solid var(--meo-view-muted-foreground)}
${root} [align=left]{text-align:left}${root} [align=center]{text-align:center}${root} [align=right]{text-align:right}
${root} pre{margin:0;white-space:pre-wrap}${root} pre>code{display:block;padding:.4em .55em}
${root} code{color:inherit;display:inline-block;max-width:100%;box-sizing:border-box;vertical-align:baseline}
${root} kbd{font-family:var(--meo-view-code-font-family);border:1px solid var(--meo-view-border);border-radius:.2em;padding:0 .2em}
${root} math{color:inherit}
`;
