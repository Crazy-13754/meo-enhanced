# Custom Preview Preset Configuration Guide

English · [简体中文](README.zh-CN.md)

Each preset consists of one UTF-8 JSON/JSONC configuration file and one to three CSS files. JSONC supports comments and trailing commas. Presets apply to standalone Preview, split Preview, and HTML/PDF exports. Word keeps its existing fixed export format. Live and Source continue to use the editor appearance.

## Quick start

1. Copy the [Paper Notes example](examples/paper-notes/) (light and dark) or the [GitHub Paper example](examples/github-paper/) (light only). Keep the CSS files referenced by the configuration.
2. Edit `id`, `name`, `description`, and the CSS. Keeping the same `id` updates an existing preset; changing it creates another preset. Names are displayed as written. Descriptions accept plain text or English and Chinese translations.
3. Choose **Custom presets…** at the bottom of Preview's **Preview preset** menu to open **Settings → Preview presets**. Click **Import preset** and select a folder containing exactly one `preset.jsonc` or `preset.json` at its root. The command palette's **MEO Enhanced: Manage custom preview presets** opens the same page.
4. New imports are enabled without switching the current Preview. Select the new preset in Preview's toolbar. Dual-theme presets support Auto / Light / Dark; single-theme controls remain visible but disabled, with an explanation.
5. Check the Preview before exporting HTML/PDF. After editing CSS, import the folder again. The same ID prompts for an update; a failed update retains the previous version.

## Standard examples of built-in styles

Each built-in style has an importable folder containing `preset.jsonc` and every referenced CSS file:

| Example folder | Themes | Base styles |
| --- | --- | --- |
| [Default](examples/default/) | Light, dark | `default` |
| [GitHub README](examples/github-readme/) | Light, dark | `github-readme` |
| [Typora Newsprint](examples/newsprint/) | Light | `default` + `common.css`, `light.css` |
| [Typora Whitey](examples/whitey/) | Light, dark | `default` + `common.css`, theme CSS |
| [Obsidian Minimal](examples/obsidian-minimal/) | Light, dark | `default` + `common.css`, theme CSS |

Copy the entire folder, edit `id`, localized `name`, and CSS, then import it using the quick-start steps. This creates a custom copy without replacing a built-in preset. Default and GitHub theme files provide override entry points; the extension supplies their base CSS. The Default copy uses fixed base colors. The GitHub copy inherits reading styles, while Markdown support follows custom preset rules.

The two floating buttons, options panel, and dropdown lists in Source's side preview follow the preview document colors. Standalone Preview toolbars and menus continue to follow the editor theme. Tooltips use the same style in every location.

## Manage presets

- Built-in presets are always enabled and cannot be removed.
- Check a custom preset to show it in Preview's menu. Unchecking hides the entry but keeps its files. Open previews using that preset return to Default; enabling it again does not switch the preview.
- Each information icon shares the Preview toolbar component and shows only the description and necessary error details. Relevant differences belong in the description. Management does not mark the currently selected preset.
- Each custom row has **Export** and **Remove** icons after the information icon. Confirm removal in the small popover below the icon.
- Import copies validated configuration and referenced CSS without moving the originals. Updates preserve visibility; new imports are enabled.
- **Creation guide** opens the Chinese or English GitHub guide in your browser, following the current MEO interface language. Guides and examples live in this repository and are excluded from the extension package. Imported presets work offline; the small configuration Schema remains bundled for offline completion and validation.

## Configuration file

```jsonc
{
  "schemaVersion": 1,
  "id": "paper-notes",
  "name": "Paper Notes",
  "description": "For long documents, notes, and code reading.",
  "base": "default",
  "controls": {
    "htmlComments": { "mode": "editable" },
    "codeColoring": { "mode": "editable" }
  },
  "styles": { "common": "common.css" },
  "themes": {
    "light": { "css": "light.css", "codeTheme": "light-plus" },
    "dark": { "css": "dark.css", "codeTheme": "dark-plus" }
  }
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Required. Currently `1`. |
| `id` | Required stable identifier, up to 64 characters. Start with a lowercase letter, followed by lowercase letters, digits, or hyphens. |
| `name` | Required string or `{ "en": "Paper notes", "zh-CN": "纸面笔记" }`; up to 80 characters per name. Follows the UI language and falls back to the available translation. Presets with the same name remain distinct by ID. |
| `description` | Required explanation, including relevant differences. Accepts a string or an object with `en` / `zh-CN`, up to 500 characters per language. Follows the UI language and falls back to the available translation; a string appears unchanged in both languages. |
| `base` | Optional: `default` or `github-readme`. Inherits fixed document styles and light/dark base palettes, without editor colors. Defaults to `default`. |
| `controls.htmlComments` / `controls.codeColoring` | Optional independent policies for HTML comments and code coloring. Omitted controls are editable. |
| `controls.fontFamily` | Optional `{ "mode": "editable" }` or `{ "mode": "fixed" }`. Omitted means fixed for compatibility. Editable presets remember separate body and code fonts; the pinned empty choice restores preset CSS. Code font applies to inline code and fenced blocks without changing their typography. |
| `styles.common` | Optional CSS shared by both themes. |
| `themes.light` / `themes.dark` | Provide at least one. Each theme requires `css`. The entries determine which themes are supported. |
| `codeTheme` | Optional: `light-plus`, `dark-plus`, `github-light-default`, or `github-dark-default`. When omitted, the Default base uses fixed Light+/Dark+ palettes, and the GitHub base uses fixed GitHub light/dark palettes. Applies only when coloring is enabled; it does not enable or lock coloring. |
| `author` / `version` / `source` / `license` | Optional sharing metadata, up to 500 characters each. Stored in the configuration without appearing in the information tooltip. |
| `$schema` | Optional link to the [JSON Schema](preset.schema.json) for completion and validation. After copying an example, update its relative path or remove this field. |

`base` determines appearance without inheriting control policies. All custom presets use MEO Markdown rendering, including line breaks, Alerts, task lists, and HTML comment handling. A preset based on `github-readme` uses GitHub styles and can still show comments. CSS loads in this order: base styles → common → current theme. Built-in Default and GitHub retain their existing behavior; built-in GitHub still hides comments and enables code coloring. Imports cannot replace built-ins, and custom presets cannot inherit from other custom presets.

For a bilingual description, provide either or both translations:

```jsonc
"description": {
  "en": "For long documents and notes.",
  "zh-CN": "适合长文和笔记阅读。"
}
```

Name the root configuration `preset.jsonc` or `preset.json`. Use `$schema` for completion and validation.

CSS defines the preset's fonts and document width. Font selection is editable only when `controls.fontFamily` is `editable`. Fixed or unsupported controls are hidden, except the disabled theme control for a single-theme preset. `themes` determines theme support: presets with both light and dark start in Auto; single-theme presets use their supported theme. Theme, editable font, code coloring and HTML comment choices are remembered separately for each preset, across preset switches and newly opened documents. Default continues to use the existing VS Code settings.

### Color ownership

The built-in Default preset continues to follow the editor theme. GitHub and custom presets own their document colors. Changing the VS Code theme may select a different light/dark scheme in Auto mode, but colors within each scheme remain fixed. Preview and HTML/PDF share these color rules. Toolbars, menus, and settings continue to use the extension's shared UI palette.

Define page backgrounds, document text, headings, links, code backgrounds, tables, quotes, and dividers together in each light/dark CSS file. CSS variables and `color-mix()` can derive muted text, borders, and secondary surfaces within the preset. Do not depend on `--vscode-*` variables or editor syntax colors. Unspecified colors fall back to the selected base's fixed palette; existing presets remain importable without new fields.

`--meo-bg` and `--meo-code-bg` control page and code block backgrounds. `codeTheme` controls syntax colors; the syntax theme's background does not replace the CSS background. Explicitly naming `codeTheme` makes each scheme's palette easy to review. See the complete variables and derived colors in the Paper Notes [light](examples/paper-notes/light.css) and [dark](examples/paper-notes/dark.css) examples. Local backgrounds in the GitHub base still need the selector overrides described below.

### Comments and code coloring

`controls` supports `fontFamily`, `htmlComments`, and `codeColoring`. For font selection, use `{ "mode": "editable" }` to expose a per-preset body font override, or `{ "mode": "fixed" }` to keep the CSS font. Omitted font policies remain fixed for compatibility. Choosing **Preset font** restores the original CSS; other choices apply after preset CSS and do not overwrite Default's font setting. Code typography remains defined by the CSS.

Configure comments and code coloring independently:

| Configuration | Behavior |
| --- | --- |
| Omitted or `{ "mode": "editable" }` | The control is editable and uses the user's current setting. |
| `{ "mode": "fixed", "value": true }` | Always show comments or enable code coloring. |
| `{ "mode": "fixed", "value": false }` | Always hide comments or disable code coloring. |

Fixed comment and code-coloring controls remain visible but disabled, with explanatory tooltips that stay visible after a click. A single supported theme also keeps its theme control visible but disabled. Fixed values do not overwrite user preferences; switching to an editable preset restores the user's choices. `editable` accepts no `value`; `fixed` requires a boolean `value`. These policies apply to Preview and HTML/PDF.

Default, GitHub, and custom presets share the same information and control rules. Built-in configurations are provided by the extension and cannot be replaced by user configuration files. Information shows only the description and necessary error details, without control policies, author information, or licensing metadata.

When import, loading, or rendering fails, the information icon turns red and displays error details. A failed update retains the previous version. A preset that cannot load at startup is skipped and falls back to Default, with its loading error shown in preset information. Correcting and successfully reimporting the package clears its error. Source files and saved copies are not watched automatically; reimport or reload the window after editing.

For example, allow comments to be toggled and keep code coloring enabled:

```jsonc
"controls": {
  "htmlComments": { "mode": "editable" },
  "codeColoring": { "mode": "fixed", "value": true }
}
```

[Paper Notes](examples/paper-notes/) demonstrates two editable controls and independent light/dark code palettes. [GitHub Paper](examples/github-paper/) demonstrates editable comments and fixed code coloring. Edit either example's `controls` and reimport to apply the change.

## Writing and scoping CSS

Each document selector must start with `.meo-export-doc`. Prefix every selector in a list, such as `.meo-export-doc h1, .meo-export-doc h2`. Ordinary CSS and `@media`, `@supports`, and `@layer` blocks are supported. Nested selectors, `@import`, `@font-face`, `url()`, `image-set()`, and scripts are not supported. Use installed system fonts with fallback fonts.

`html`, `body`, and `:root` may only declare CSS variables for the document theme. The document runs in a separate preview frame. Its CSS is not loaded into the editor toolbar, segmented controls, tooltips, or sidebar outline.

Put layout in the common file and colors in the theme files:

```css
/* common.css */
.meo-export-doc {
  max-width: 960px;
  padding: 32px;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.75;
}
.meo-export-doc h1 { font-size: 30px; color: var(--accent); }
.meo-export-doc pre { font-size: 13px; padding: 12px 16px; }
```

```css
/* light.css */
:root {
  --meo-bg: #fafaf8;
  --meo-fg: #333333;
  --meo-code-bg: #eeefec;
  --accent: #28645b;
}
```

`--meo-bg` sets the background of the preview canvas, document, and exported page. `--meo-fg` sets document text, and `--meo-code-bg` sets code block backgrounds for the Default base. Other available variables include `--meo-heading`, `--meo-link`, `--meo-muted`, and `--meo-border`. For the GitHub base, override local styles such as code backgrounds directly with `.meo-export-doc pre` or `.meo-export-doc th`. Its upstream variables are defined on `.markdown-body`, so root variables may not override them.

| Content | Recommended selectors |
| --- | --- |
| Document, paragraphs, headings | `.meo-export-doc`, `.meo-export-doc p`, `.meo-export-doc h1` through `h6` |
| Links, quotes, lists | `.meo-export-doc a`, `.meo-export-doc blockquote`, `.meo-export-doc ul` / `ol` / `li` |
| Inline code, code blocks | `.meo-export-doc code`, `.meo-export-doc pre` |
| Code line text | `.meo-export-doc .meo-export-code-line-source` |
| Tables, images | `.meo-export-doc table` / `th` / `td` / `img` |
| Exported table of contents | `.meo-export-doc .meo-export-toc` / `.meo-export-toc-title` / `.meo-export-toc-link` |
| Formula and diagram containers | `.meo-export-doc .meo-export-math-display`, `.meo-export-doc .meo-export-mermaid` |

Shiki generates syntax colors as inline styles. Changing `pre { color: ... }` does not replace the syntax palette; use `codeTheme` for a fixed palette. Base styles may set font sizes on child elements, so when changing code block sizes, also consider `.meo-export-code-line-source` or `pre > code`. Formulas use KaTeX, and diagrams follow the existing Mermaid rendering rules. Internal node selectors may change with those libraries and are not a stable configuration interface.

Avoid scaling or transforming formula internals, as this can affect viewport measurements. Keep document widths responsive and avoid fixed minimum widths. Presets cannot add Markdown syntax or execute JavaScript.

### Migrating existing CSS

Replace the original document layout selector `body { ... }` with `.meo-export-doc { ... }`. Change selectors such as `h1` and `pre` to `.meo-export-doc h1` and `.meo-export-doc pre`. Replace a global `*` with `.meo-export-doc *`, keeping in mind that it also affects formula and diagram internals. Prefix each selector in a list separately. Prefer setting background and text colors through `--meo-bg` and `--meo-fg` in theme files.

Replace a fixed `width: 800px` with `width: 100%; max-width: 800px` to fit narrow panels. Adjust font sizes and padding for code areas. Use the `.meo-export-toc` selectors above for the exported table of contents. Existing CSS needs a configuration file before import; it is not loaded as global CSS.

## Saving, updating, and sharing

Import reads the configuration and referenced CSS. After all validation succeeds, it saves a complete copy in `globalStorageUri/preview-presets/<id>/`. Each preset is one folder containing a readable `preset.jsonc` and the referenced CSS files. CSS retains its original text, comments, and actual line breaks. Configuration is saved with two-space indentation; loading accepts both single-line JSON and JSONC with comments. Import, storage, and export use the same file structure.

```text
preview-presets/
├── paper-notes/
│   ├── preset.jsonc
│   ├── common.css
│   ├── light.css
│   └── dark.css
└── github-paper/
    ├── preset.jsonc
    └── light.css
```

Folder names use the stable `id`; `name` controls the display label. CSS names and subdirectories follow the configuration references. Updates write and read back the complete package in a temporary directory before switching the active folder. A failed switch restores the previous version, and startup restores a complete previous folder left by an interrupted switch. Temporary directories and backups are not catalog entries. Removal also clears recoverable previous versions so a preset cannot return after restart.

Earlier development versions stored each preset in `<id>.json`. Loading migrates those files automatically and moves the original into `.legacy/` as a backup after success. A failed migration leaves the legacy preset usable. If an active folder already exists for an ID, it takes precedence and appears only once. Invalid legacy records are not overwritten.

The managed storage path is described above. After editing a saved copy, import its whole folder again or reload the VS Code window; files are not watched automatically. Use **More → Export** on a custom preset row to share a complete folder that another computer can import directly. Backups must include the configuration and all referenced CSS.

These files are not written into the current project. Moving or deleting the original import files does not affect saved presets. Presets reload after restart and normal extension upgrades, and workspaces in the same extension environment share the library. The first version does not automatically synchronize across computers, VS Code profiles, or remote extension environments. Other VS Code windows that are already open need to reload to read new styles.

Importing the same ID asks for confirmation, updates that preset and preserves its visibility. If import fails, its previous styles remain available. Removal only deletes the saved copy; open previews using it return to Default. Missing presets also fall back to Default when a document opens. Damaged saved records are reported and skipped.

Configuration files and individual CSS files are limited to 512 KiB each, a package to 2 MiB, and the library to 100 presets. CSS references must be relative paths inside the configuration directory. Path segments use English letters, digits, underscores, hyphens, and dots in filenames. Absolute paths, parent-directory traversal, symbolic links, and remote references are not supported. Import errors identify the field or CSS file and explain the reason.

## HTML, PDF, and Word

HTML/PDF exports for Default, GitHub, and custom presets use the actual preview preset, resolved light/dark theme, and colors captured when export starts. Auto resolves to the editor's current appearance. Changing themes or updating styles during export does not change the captured export. When Preview is closed, export still uses the current document's preview configuration. Word keeps its fixed styles.

PDF uses A4 with shared 20 mm page margins by default; presets need no margin configuration. Existing explicit page-margin styles take precedence. Wide tables, long code, and formulas adapt to the paper. Screen and paper widths differ, so long content may still wrap.

**With table of contents** generates a table of contents inside the exported document. The editor's sidebar outline is UI and is not exported. Interactive preview features such as copy buttons and search markers are also excluded. If an HTML reader does not have the requested fonts installed, CSS fallback fonts are used.

Check light and dark themes and narrow panels. Export HTML/PDF containing headings, a table of contents, long code, wide tables, Chinese text, formulas, and Mermaid. For multipage PDFs, check margins and content completeness on each page. Also switch back to built-in Default and GitHub to verify their settings are restored.
