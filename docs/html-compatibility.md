# HTML compatibility

Live and ordinary Preview share their HTML content policy in
`src/shared/htmlPolicy.ts` and CSS validation in `src/shared/htmlStyle.ts`.
Their DOM, typography and editing controls remain surface-owned. Switching
surfaces must not turn supported HTML into source or discard its content.
The compatibility reference is VS Code's built-in Markdown Preview with its
default security settings, for common static document content.

The GitHub README preset keeps its separate, captured GitHub compatibility
policy. Extending ordinary HTML must not widen that preset's tag, attribute,
style or resource policy.

## Content

Supported content includes document structure and text semantics, lists,
disclosures, tables and column/cell attributes, pictures and image candidates,
native audio/video controls, ordinary form controls, static SVG and MathML.
The exported tag and attribute sets are the authoritative catalog used by
source assistance and both renderers. Generic `class`, `aria-*` and `data-*`
attributes are supported; editor-owned classes, IDs and source/resource markers
remain reserved. Native control values are temporary presentation state, not
edits to the Markdown. Form submission is prevented.

Within a mounted Live HTML block, unrelated source edits retain unchanged
pictures, responsive images, media playback, form values and nested disclosure
state. Changed or removed resources use the existing resolution/disposal owners.
Source-bound controls receive current callbacks and coordinates. External document
replacement invalidates the old HTML editing range, including equal-text reloads;
the new document's syntax determines any remaining source presentation.

Unknown tags inside a supported fragment are shown as escaped markup without
discarding supported siblings or children. Unsupported standalone fragments
retain their source. Script elements and event attributes never execute.
Frame/object embedding, active SVG content and executable document behavior
are outside this policy.

CommonMark still owns HTML/Markdown boundaries: continuous block HTML keeps
Markdown punctuation literal; blank lines can return content to Markdown
parsing. Inline HTML participates in inline Markdown. MEO retains its existing
literal HTML `code` rule. Source, selections and history always refer to the
original Markdown, never serialized rendered DOM.

## Styles and resources

See [inline styles](html-inline-styles.md) for the declaration policy. Document
`style` elements use the same declaration validation. Selectors are scoped to
the reading document, excluding exposed HTML source and preview labels. Only
conditional `media`, `supports` and `container` rules are retained; imports,
font registration and executable/resource CSS are filtered.

Live owns one derived stylesheet per surface. Optimized documents collect it
in the existing Markdown context worker and retain it through proven plain-text
projections. Preview carries it in its existing presentation styles. Styles do
not depend on whether the source block is currently mounted, and author styles
cannot select the surrounding toolbar or workbench.

Pictures keep native `source`/`img` structure. Pictures and media reuse the
existing resource resolver and surface cancellation/geometry lifecycle. Removed
Live media stop loading/playing; aborted pending Preview resources retain their
source markers for the next presentation. Local export resources use the
ordinary asset pipeline. HTML/PDF/DOCX share content filtering, while format
capabilities can differ (for example, native media and advanced CSS in Word).

## Verification

`bun scripts/test-html-content.ts --styles-only` covers the shared policy and
production Live, Preview and Source side Preview in ordinary and optimized
documents, including computed grid/flex/CSS-variable styles, SVG/MathML,
controls, pictures, CommonMark containers, source preservation and unchanged
node identity. `scripts/test-html-content.ts` also owns HTML editing, selection,
history and mode transitions. `scripts/test-github-readme-compatibility.ts`
retains the independent GitHub reference corpus.
