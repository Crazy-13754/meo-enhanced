export type InlineBoundaryStyle = 'emphasis' | 'strong' | 'strikethrough' | 'highlight' | 'code' | 'subscript' | 'superscript';

export type InlineBoundaryFixture = {
  name: string;
  markdown: string;
  styles: readonly InlineBoundaryStyle[];
  literal?: string;
  mathCount?: number;
  href?: string;
};

export const inlineSyntaxBoundaryFixtures: readonly InlineBoundaryFixture[] = [
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
  { name: 'link-label', markdown: '[*TARGET：*后续](https://example.com)', styles: ['emphasis'], href: 'https://example.com' },
  { name: 'normal-html', markdown: 'before <b>TARGET</b> after', styles: ['strong'] },
  ...(['*', '**', '~~', '=='] as const).map((marker, index) => ({
    name: `table-style-${index}`, markdown: `| Header |\n| --- |\n| ${marker}TARGET：${marker}后续 |`,
    styles: [(['emphasis', 'strong', 'strikethrough', 'highlight'] as const)[index]!]
  })),
  { name: 'table-code', markdown: '| Header |\n| --- |\n| `(TARGET*)(b*)` |', styles: ['code'], literal: '(TARGET*)(b*)' },
  { name: 'heading-code', markdown: '# `(TARGET*)(b*)`', styles: ['code'], literal: '(TARGET*)(b*)' }
];
