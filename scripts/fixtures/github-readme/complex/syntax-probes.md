# GitHub syntax boundary probes

## Inline delimiters

P01 ASCII with spaces: $a+b$.

P02 ASCII without spaces:$a+b$.

P03 中文有空格： $a+b$。

P04 中文无空格：$a+b$。

P05 start of paragraph:

$a+b$

## P06 Heading with spaces $a+b$

## Table contexts

| Case | Content |
| --- | --- |
| P07 only formula | $a+b$ |
| P08 text with spaces | Formula $a+b$ end |
| P09 text without spaces | 公式：$a+b$。 |

## Display math contexts

P10 top level:

$$
a+b=c
$$

- P11 list item:

  $$
  a+b=c
  $$

> P12 quote:
>
> $$
> a+b=c
> $$

## Footnote contexts

P13 footnote with formula.[^formula]

P14 footnote with diagram.[^diagram]

[^formula]: Formula $a+b$ end.

    $$
    a+b=c
    $$

[^diagram]: A diagram follows.

    ```mermaid
    flowchart LR
      A[Start] --> B[End]
    ```

## HTML and anchors

P15 <del>deleted text</del> and <s>other deleted text</s>.

## P16 · Anchor / punctuation

[Jump to P16](#p16--anchor--punctuation)
