# Task overview integration

MEO Extras contributes an optional task overview. Enable it under Settings → Extension features, then use the task icon in the editor toolbar. The matching development version of MEO Enhanced must expose `supportsWorkspaceDocuments`.

The view supports the current document or the open VS Code workspace, file grouping, heading context, text/status/file filters, source navigation and completion toggles. Only ordinary Markdown task list markers (`[ ]`, `[x]`, `[X]`) participate. Fenced examples, indented code, HTML blocks and frontmatter are not tasks. Nested and quoted list items retain their source locations.

The main editor supplies complete Markdown list structure through its existing background reading worker. Extras owns the task index and view; it does not parse Markdown independently or access the editor's private DOM. Workspace access is available only to registered views declaring `workspace: true`, and each mounted view has a request scope. Reads and edits are limited to its current document and discovered workspace Markdown files.

## Editing and history

An edit carries the snapshot's opaque content identity, normalized offset, expected text and replacement. The host reads the latest content and rejects stale edits; the editor checks the complete source again immediately before its transaction. A pending input composition must finish before an edit is accepted.

Files open in MEO use the existing editor transaction and per-document undo/redo history, including unsaved text. Other files use VS Code TextDocument and WorkspaceEdit, preserving native document history and line endings. Undo/redo belongs to the corresponding document: use its MEO editor for MEO transactions, or VS Code's text editor for native transactions. The overview does not introduce a separate workspace-wide history. Changes follow existing save/auto-save settings; toggling does not force a save.

## Work and lifecycle

Enabling the feature only registers its description and entry. Opening the view loads its module and starts indexing; changing files refreshes those files. The current document uses its live editor content. A short debounce coalesces updates, and file reads are serialized with yields between files. Rendering paginates task rows; filters operate on the complete collected index, including offscreen tasks.

Workspace enumeration respects enabled `files.exclude` and `search.exclude` patterns and excludes `.git`, `node_modules`, `dist`, `.cache` and `.obsidian`. Multi-root workspaces retain file identity. With no open workspace, the view uses the current document. The current document remains available even when excluded from workspace discovery.

Enumeration is capped at 10,000 files and indexing at 8 MiB per source. Limits and unreadable files are reported in the view, never represented as a complete empty result. The host retains at most 32 parsed document results; the feature retains task projections rather than document text for workspace files. Closing or disabling the view releases file listeners, cancels enumeration, clears its index and rejects pending view requests. Shared reading-worker lifetime remains owned by the main editor.

## Validation

`bun scripts/test-workspace-documents.ts` verifies grammar, source ranges, large content, protocol and request lifecycle. `bun scripts/test-workspace-documents-host.ts` verifies scoped access, stale edits, unsaved buffers, native/editor routing and disposal. With a built companion, set `MEO_EXTRAS_DIR` and run `bun scripts/test-task-overview-browser.ts` for real-editor task interactions and visual coverage. The companion's `bun scripts/test-tasks.ts` verifies incremental indexing, scope switches, failure recovery and disposal.

This integration belongs to the next extension development version; it does not change the pending main-editor release scope.
