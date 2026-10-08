export type InlineBoundaryStyle = 'emphasis' | 'strong' | 'strikethrough' | 'highlight' | 'code' | 'subscript' | 'superscript';

export type InlineBoundaryFixture = {
  name: string;
  markdown: string;
  styles: readonly InlineBoundaryStyle[];
  literal?: string;
  forbiddenLiteral?: string;
  mathCount?: number;
  href?: string;
  witnesses?: readonly { text: string; styles: readonly InlineBoundaryStyle[] }[];
};

const proseFixtures: readonly InlineBoundaryFixture[] = [
  ...[3, 4, 5].map(length => ({ name: `literal-tilde-run-${length}`, markdown: `前${'~'.repeat(length)}TARGET：${'~'.repeat(length)}后`, styles: [], literal: `${'~'.repeat(length)}TARGET：${'~'.repeat(length)}` })),
  { name: 'math-comment-closing-dollar', markdown: 'TARGET $x <!-- y$ --> z$ AFTER', styles: [], mathCount: 1, forbiddenLiteral: '--> z$', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'strike-leading-space', markdown: '~~ TARGET~~', styles: [], literal: '~~ TARGET~~' },
  { name: 'issue-pointer-stars', markdown: 'TARGET 对于 `float* row = (float*)((char*)devPtr + r * pitch);`，其中 `devPtr` 的类型是 `float*` 和 `char*`。', styles: [], literal: 'float* row = (float*)((char*)devPtr + r * pitch);' },
  ...(['*', '**', '~~', '=='] as const).flatMap(marker => [
    { name: `code-${marker}`, markdown: `\`(TARGET${marker})(b${marker})\``, styles: ['code'] as const, literal: `(TARGET${marker})(b${marker})` },
    { name: `separate-code-${marker}`, markdown: `\`TARGET${marker}\` 和 \`OTHER${marker}\``, styles: ['code'] as const, literal: `TARGET${marker}` }
  ]),
  { name: 'autolink-stars', markdown: '<https://example.com/TARGET*)b*c>', styles: [], literal: 'TARGET*)b*c', href: 'https://example.com/TARGET*)b*c' },
  { name: 'link-title', markdown: '[TARGET](https://example.com "a*)b*c $x$")', styles: [], mathCount: 0 },
  { name: 'link-destination', markdown: '[TARGET](https://example.com/$x$)', styles: [], mathCount: 0, href: 'https://example.com/$x$' },
  { name: 'comment-stars', markdown: 'before <!-- (TARGET*)(b*) --> after', styles: [], literal: '(TARGET*)(b*)' },
  { name: 'comment-html', markdown: 'before <!-- <b>TARGET</b> --> after', styles: [], literal: '<b>TARGET</b>' },
  { name: 'comment-math', markdown: 'before <!-- $TARGET$ --> after', styles: [], literal: '$TARGET$', mathCount: 0 },
  { name: 'subscript-stars', markdown: '~(TARGET*)(b*)~', styles: ['subscript'], literal: '(TARGET*)(b*)' },
  { name: 'superscript-html', markdown: '^<b>TARGET</b>^', styles: ['superscript'], literal: '<b>TARGET</b>' },
  { name: 'subscript-math', markdown: '~$TARGET$~', styles: ['subscript'], literal: '$TARGET$', mathCount: 0 },
  { name: 'superscript-math', markdown: '^$TARGET$^', styles: ['superscript'], literal: '$TARGET$', mathCount: 0 },
  { name: 'html-in-code', markdown: '`<b>TARGET</b>`', styles: ['code'], literal: '<b>TARGET</b>' },
  { name: 'html-in-double-code', markdown: '``<b>TARGET</b>``', styles: ['code'], literal: '<b>TARGET</b>' },
  { name: 'html-fenced', markdown: '```html\n<b>TARGET</b>\n```', styles: ['code'], literal: '<b>TARGET</b>' },
  { name: 'html-indented', markdown: '    <b>TARGET</b>', styles: ['code'], literal: '<b>TARGET</b>' },
  { name: 'html-escaped', markdown: '\\<b>TARGET</b>', styles: [], literal: '<b>TARGET' },
  { name: 'html-escaped-pair', markdown: '\\<b>TARGET\\</b>', styles: [], literal: '<b>TARGET</b>' },
  { name: 'html-code-math', markdown: '<code>$TARGET$</code>', styles: ['code'], literal: '$TARGET$', mathCount: 0 },
  { name: 'autolink-math', markdown: '<https://example.com/$TARGET$>', styles: [], literal: '$TARGET$', mathCount: 0, href: 'https://example.com/$TARGET$' },
  { name: 'punctuation-emphasis', markdown: '*TARGET：*后续', styles: ['emphasis'] },
  { name: 'punctuation-strong', markdown: '**TARGET：**后续', styles: ['strong'] },
  { name: 'punctuation-strike', markdown: '~~TARGET：~~后续', styles: ['strikethrough'] },
  { name: 'punctuation-highlight', markdown: '==TARGET：==后续', styles: ['highlight'] },
  { name: 'left-punctuation', markdown: '前**[TARGET]**', styles: ['strong'] },
  { name: 'nested-code', markdown: '**`TARGET`：**后续', styles: ['strong', 'code'] },
  { name: 'code-delimiters-in-strong', markdown: '**`TARGET**`：**后续', styles: ['strong', 'code'], literal: 'TARGET**' },
  { name: 'nested-entity', markdown: '**TARGET&amp;：**后续', styles: ['strong'] },
  { name: 'nested-escape', markdown: '**TARGET\\!：**后续', styles: ['strong'] },
  { name: 'math-before-style', markdown: '$x$ **TARGET：**后续', styles: ['strong'], mathCount: 1 },
  { name: 'math-after-style', markdown: '**TARGET：**后续 $x$', styles: ['strong'], mathCount: 1 },
  { name: 'math-inside-style', markdown: '**TARGET $x$：**后续', styles: ['strong'], mathCount: 1 },
  { name: 'math-powers', markdown: 'TARGET $E=mc^2$，$a^2+b^2=c^2$', styles: [], mathCount: 2 },
  { name: 'html-code-stars', markdown: '<code>*TARGET*</code>', styles: ['code'], literal: '*TARGET*' },
  { name: 'triple-highlight', markdown: 'x===TARGET===y', styles: [], literal: 'x===TARGET===y' },
  { name: 'normal-nesting', markdown: '***TARGET***', styles: ['strong', 'emphasis'] },
  ...(['*', '**', '~~', '=='] as const).flatMap((outer, outerIndex) =>
    (['*', '**', '~~', '=='] as const).filter(inner => inner !== outer).map(inner => {
      const innerIndex = ['*', '**', '~~', '=='].indexOf(inner);
      const styles = ['emphasis', 'strong', 'strikethrough', 'highlight'] as const;
      return { name: `nested-${outerIndex}-${innerIndex}`, markdown: `${outer}outer ${inner}TARGET：${inner}AFTER${outer} OUTSIDE`,
        styles: [styles[outerIndex]!, styles[innerIndex]!], literal: 'outer TARGET：AFTER',
        witnesses: [{ text: 'AFTER', styles: [styles[outerIndex]!] }, { text: 'OUTSIDE', styles: [] }] };
    })),
  { name: 'same-strong-nesting', markdown: '**outer **TARGET：**AFTER end** OUTSIDE', styles: ['strong'], literal: 'outer TARGET：AFTER end', witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'same-emphasis-nesting', markdown: '*outer *TARGET：*AFTER end* OUTSIDE', styles: ['emphasis'], literal: 'outer TARGET：AFTER end', witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'same-strike-nesting', markdown: '~~outer ~~TARGET：~~AFTER end~~ OUTSIDE', styles: ['strikethrough'], literal: 'outer TARGET：AFTER end', witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'same-highlight-nesting', markdown: '==outer ==TARGET：==AFTER end== OUTSIDE', styles: ['highlight'], literal: 'outer TARGET：AFTER end', witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'nested-three-levels', markdown: '*outer **inner ~~TARGET：~~AFTER end** tail* OUTSIDE', styles: ['emphasis', 'strong', 'strikethrough'], literal: 'outer inner TARGET：AFTER end tail', witnesses: [{ text: 'AFTER', styles: ['emphasis', 'strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'nested-triple-run', markdown: '***outer ~~TARGET：~~AFTER*** OUTSIDE', styles: ['strong', 'emphasis', 'strikethrough'], literal: 'outer TARGET：AFTER', witnesses: [{ text: 'AFTER', styles: ['strong', 'emphasis'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'triple-punctuation', markdown: '***TARGET：***OUTSIDE', styles: ['strong', 'emphasis'], witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'adjacent-punctuation', markdown: '*FIRST*：*TARGET* OUTSIDE', styles: ['emphasis'], literal: 'FIRST：TARGET', witnesses: [{ text: 'FIRST', styles: ['emphasis'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'nested-link', markdown: '**outer [*TARGET：*AFTER](https://example.com) end** OUTSIDE', styles: ['strong', 'emphasis'], href: 'https://example.com', witnesses: [{ text: 'AFTER', styles: ['strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'link-scope', markdown: '[*TARGET：](https://example.com) AFTER* OUTSIDE', styles: [], literal: '*TARGET：', href: 'https://example.com', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'math-delimiters-nested', markdown: '**outer *TARGET $a*b$：*AFTER** OUTSIDE', styles: ['strong', 'emphasis'], mathCount: 1, witnesses: [{ text: 'AFTER', styles: ['strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'html-code-delimiters-nested', markdown: '**outer *TARGET <code>a*b</code>：*AFTER** OUTSIDE', styles: ['strong', 'emphasis'], literal: 'a*b', witnesses: [{ text: 'AFTER', styles: ['strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'nested-heading', markdown: '# **outer *TARGET：*AFTER** OUTSIDE', styles: ['strong', 'emphasis'], literal: 'outer TARGET：AFTER', witnesses: [{ text: 'AFTER', styles: ['strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'crossing-emphasis-strike', markdown: '*TARGET ~~cross*AFTER~~ OUTSIDE', styles: ['emphasis'], literal: 'TARGET ~~crossAFTER~~', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'crossing-strong-highlight', markdown: '**TARGET ==cross**AFTER== OUTSIDE', styles: ['strong'], literal: 'TARGET ==crossAFTER==', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'unclosed-outer', markdown: '**outer *TARGET：*AFTER OUTSIDE', styles: ['emphasis'], literal: '**outer TARGET：AFTER', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'unclosed-inner', markdown: '**outer ~~TARGET：AFTER end** OUTSIDE', styles: ['strong'], literal: 'outer ~~TARGET：AFTER end', witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'multiline-style', markdown: '*TARGET\nline：*AFTER', styles: ['emphasis'], witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'paragraph-scope', markdown: '*TARGET：\n\nAFTER*', styles: [], literal: '*TARGET：', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'escaped-style', markdown: '\\*TARGET：\\*AFTER', styles: [], literal: '*TARGET：*AFTER', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'script-in-strong', markdown: '**outer ~*TARGET：*~AFTER** OUTSIDE', styles: ['strong', 'subscript'], literal: '*TARGET：*AFTER', witnesses: [{ text: 'AFTER', styles: ['strong'] }] },
  { name: 'comment-in-strong', markdown: '**outer <!-- *TARGET：* --> AFTER** OUTSIDE', styles: ['strong'], literal: '*TARGET：*', witnesses: [{ text: 'AFTER', styles: ['strong'] }] },
  { name: 'html-code-quoted-attribute', markdown: '**outer <code title=">">*TARGET：*</code>AFTER** OUTSIDE', styles: ['strong', 'code'], literal: '*TARGET：*', witnesses: [{ text: 'AFTER', styles: ['strong'] }] },
  { name: 'reference-label-scope', markdown: '[*TARGET：][ref] AFTER*\n\n[ref]: https://example.com', styles: [], literal: '*TARGET：', witnesses: [{ text: 'AFTER', styles: [] }] },
  { name: 'image-label-style', markdown: '**outer ![*ALT：*AFTER](https://example.com/image.png) TARGET** OUTSIDE', styles: ['strong'], witnesses: [{ text: 'OUTSIDE', styles: [] }] },
  { name: 'table-style-nested', markdown: '| Header |\n| --- |\n| **outer *TARGET：*AFTER** OUTSIDE |', styles: ['strong', 'emphasis'], literal: 'outer TARGET：AFTER', witnesses: [{ text: 'AFTER', styles: ['strong'] }, { text: 'OUTSIDE', styles: [] }] },
  { name: 'link-label', markdown: '[*TARGET：*后续](https://example.com)', styles: ['emphasis'], href: 'https://example.com' },
  { name: 'normal-html', markdown: 'before <b>TARGET</b> after', styles: ['strong'] },
  ...(['*', '**', '~~', '=='] as const).map((marker, index) => ({
    name: `table-style-${index}`, markdown: `| Header |\n| --- |\n| ${marker}TARGET：${marker}后续 |`,
    styles: [(['emphasis', 'strong', 'strikethrough', 'highlight'] as const)[index]!]
  })),
  { name: 'table-code', markdown: '| Header |\n| --- |\n| `(TARGET*)(b*)` |', styles: ['code'], literal: '(TARGET*)(b*)' },
  { name: 'heading-code', markdown: '# `(TARGET*)(b*)`', styles: ['code'], literal: '(TARGET*)(b*)' }
];

export const inlineSyntaxBoundaryFixtures: readonly InlineBoundaryFixture[] = [
  ...proseFixtures,
  // Cells use inline Markdown; block indentation/headings and general HTML rendering
  // are not cell formatting cases. Literal HTML code is included below.
  ...proseFixtures.filter(fixture => !/[\n|]/.test(fixture.markdown) && !/^(?: {4}|#)/.test(fixture.markdown) && fixture.name !== 'normal-html')
    .map(fixture => ({ ...fixture, name: `table-${fixture.name}`, markdown: `| Boundary |\n| --- |\n| ${fixture.markdown} |` }))
];
