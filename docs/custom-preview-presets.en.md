# Custom Preview Preset Configuration Guide

English · [简体中文](custom-preview-presets.md)

Each preset consists of one UTF-8 JSON/JSONC configuration file and one to three CSS files. JSONC supports comments and trailing commas. Presets apply to standalone Preview, split Preview, and HTML/PDF exports. Word keeps its existing fixed export format. Live and Source continue to use the editor appearance.

## Quick start

1. Copy the [Paper Notes example](examples/preview-presets/paper-notes/) (light and dark) or the [GitHub Paper example](examples/preview-presets/github-paper/) (light only). Keep the CSS files referenced by the configuration.
2. Edit `id`, `name`, `description`, and the CSS. Keeping the same `id` updates an existing preset; changing it creates another preset. Names and descriptions are displayed as written, so you can replace the example's Chinese text with your own text.
3. Click **Manage custom presets** beside the preset selector in Preview, choose **Import / update preset…**, and select the configuration file. You can also use **MEO Enhanced: Manage custom preview presets** in the Command Palette.
4. After a successful import, the current Preview switches to the new preset. Presets with both themes support Auto / Light / Dark. For a single theme, the theme controls remain visible but disabled, with a tooltip explaining the supported theme.
5. Check the Preview before exporting HTML/PDF. After editing the original CSS, import the configuration again; the editor does not watch the source files automatically.

**Configuration guide** in the management menu opens the bundled local guide in the current MEO interface language. Use the links at the top of the guide to switch languages manually. Examples and the Schema are also bundled, so no internet connection is needed.

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
| `name` | Required menu label, up to 80 characters. Presets with the same name remain distinct by ID. |
| `description` | Required text for the preset information tooltip, up to 500 characters. |
| `base` | Optional: `default` or `github-readme`. Inherits document styles and the default code palette only. Defaults to `default`. |
| `controls.htmlComments` / `controls.codeColoring` | Optional independent policies for HTML comments and code coloring. Omitted controls are editable. |
| `styles.common` | Optional CSS shared by both themes. |
| `themes.light` / `themes.dark` | Provide at least one. Each theme requires `css`. The entries determine which themes are supported. |
| `codeTheme` | Optional: `light-plus`, `dark-plus`, `github-light-default`, or `github-dark-default`. Omit it to inherit the base preset's palette. Applies only when coloring is enabled; it does not enable or lock coloring. |
| `author` / `version` / `source` / `license` | Optional sharing metadata, up to 500 characters each. They do not affect rendering. |
| `$schema` | Optional link to the [JSON Schema](../schemas/custom-preview-preset.schema.json) for completion and validation. After copying an example, update its relative path or remove this field. |

`base` determines appearance without inheriting control policies. All custom presets use MEO Markdown rendering, including line breaks, Alerts, task lists, and HTML comment handling. A preset based on `github-readme` uses GitHub styles and can still show comments. CSS loads in this order: base styles → common → current theme. Built-in Default and GitHub retain their existing behavior; built-in GitHub still hides comments and enables code coloring. Imports cannot replace built-ins, and custom presets cannot inherit from other custom presets.

You can name the configuration `paper-notes.meo-preset.jsonc` to have the installed extension associate its Schema automatically. For other filenames, specify the Schema with `$schema`.

CSS controls custom fonts and document width, so the corresponding menu controls are hidden. `themes` determines theme support. Preset selection and theme preferences are restored for the current document.

### Comments and code coloring

`controls` supports only `htmlComments` and `codeColoring`. Configure each independently:

| Configuration | Behavior |
| --- | --- |
| Omitted or `{ "mode": "editable" }` | The control is editable and uses the user's current setting. |
| `{ "mode": "fixed", "value": true }` | Always show comments or enable code coloring. |
| `{ "mode": "fixed", "value": false }` | Always hide comments or disable code coloring. |

Fixed comment and code-coloring controls are hidden; their effective values appear in preset information. Theme controls are the exception: a single supported theme keeps them visible but disabled, with an explanatory tooltip. Fixed values do not overwrite user preferences; switching to an editable preset restores the user's choices. `editable` accepts no `value`; `fixed` requires a boolean `value`. These policies apply to Preview and HTML/PDF.

Default, GitHub, and custom presets share the same information and control rules. Built-in configurations are provided by the extension and cannot be replaced by user configuration files. Information shows the author's text first, then a divider and fixed fields: supported themes, current light/dark appearance, and configuration policies for HTML comments, code coloring, font, and document width.

When import, loading, or rendering fails, the information icon turns red and displays error details. A failed update retains the previous version. A preset that cannot load at startup is skipped and falls back to Default, with its loading error shown in preset information. Correcting and successfully reimporting the package clears its error. Source files and saved copies are not watched automatically; reimport or reload the window after editing.

For example, allow comments to be toggled and keep code coloring enabled:

```jsonc
"controls": {
  "htmlComments": { "mode": "editable" },
  "codeColoring": { "mode": "fixed", "value": true }
}
```

[Paper Notes](examples/preview-presets/paper-notes/) demonstrates two editable controls and independent light/dark code palettes. [GitHub Paper](examples/preview-presets/github-paper/) demonstrates editable comments and fixed code coloring. Edit either example's `controls` and reimport to apply the change.

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

Use **Open preset storage folder** to inspect, edit, or back up whole presets. After editing, import the folder's `preset.jsonc` again to apply changes immediately, or reload the VS Code window to read them again; files are not watched automatically. Use **Export preset files…** to share a complete folder that another computer can import directly. Backups must include the configuration and all referenced CSS.

These files are not written into the current project. Moving or deleting the original import files does not affect saved presets. Presets reload after restart and normal extension upgrades, and workspaces in the same extension environment share the library. The first version does not automatically synchronize across computers, VS Code profiles, or remote extension environments. Other VS Code windows that are already open need to reload to read new styles.

Importing the same ID updates that preset. If import fails, its previous styles remain available. Removal only deletes the saved copy; open previews using it return to Default. Missing presets also fall back to Default when a document opens. Damaged saved records are reported and skipped.

Configuration files and individual CSS files are limited to 512 KiB each, a package to 2 MiB, and the library to 100 presets. CSS references must be relative paths inside the configuration directory. Path segments use English letters, digits, underscores, hyphens, and dots in filenames. Absolute paths, parent-directory traversal, symbolic links, and remote references are not supported. Import errors identify the field or CSS file and explain the reason.

## HTML, PDF, and Word

HTML/PDF exports for Default, GitHub, and custom presets use the actual preview preset, resolved light/dark theme, and colors captured when export starts. Auto resolves to the editor's current appearance. Changing themes or updating styles during export does not change the captured export. When Preview is closed, export still uses the current document's preview configuration. Word keeps its fixed styles.

PDF keeps the existing A4 layout and pagination rules, adapting wide tables, long code, and formulas to the page. CSS can adjust font size, padding, and document width, but screen and page widths differ, so arbitrary long code may still wrap. The first version has no separate PDF CSS or paper configuration.

**With table of contents** generates a table of contents inside the exported document. The editor's sidebar outline is UI and is not exported. Interactive preview features such as copy buttons and search markers are also excluded. If an HTML reader does not have the requested fonts installed, CSS fallback fonts are used.

Check light and dark themes and narrow panels. Export HTML/PDF containing headings, a table of contents, long code, wide tables, Chinese text, formulas, and Mermaid. For multipage PDFs, check margins and content completeness on each page. Also switch back to built-in Default and GitHub to verify their settings are restored.
