export const documentViewStyles = `
.mm-view-panel{--meo-view-font-family:var(--meo-font-live,var(--vscode-editor-font-family,monospace));--meo-view-font-size:var(--meo-user-editor-font-size,var(--meo-font-live-size,16px));--meo-view-font-weight:var(--meo-font-live-weight,400);--meo-view-code-font-family:var(--meo-font-source,var(--vscode-editor-font-family,monospace));position:absolute;inset:40px 0 0;z-index:240;display:flex;flex-direction:column;background:var(--meo-view-background,var(--meo-background));color:var(--meo-view-foreground,var(--meo-foreground));font:13px var(--vscode-font-family,system-ui)}
.mm-view-panel[hidden]{display:none}
.mm-view-panel.is-side{position:relative;inset:auto;grid-area:1 / 2;min-width:0;min-height:0;border-left:1px solid var(--meo-ui-separator)}
.document-view-toolbar{position:absolute;z-index:1;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;flex-wrap:nowrap;gap:2px;max-width:calc(100% - 16px);box-sizing:border-box;padding:3px 5px;overflow-x:auto;white-space:nowrap;border:1px solid var(--meo-ui-border-float);border-radius:8px;background:var(--meo-ui-surface)}
.document-view-toolbar[hidden]{display:none}
.document-view-toolbar.is-header{position:static;transform:none;max-width:none;padding:0;border:0;background:transparent;overflow:visible;gap:0;flex:none}
.document-view-toolbar.is-header .document-view-tool-separator{display:none}
.document-view-filter-control{font:inherit;height:auto;max-width:100%}
.document-view-filter-control>.preview-select-label{display:none}
.document-view-filter-control .preview-select-shell{width:100%}
.document-view-filter-control .preview-toolbar-dropdown{width:100%;height:30px;border-radius:4px;min-width:0;font:inherit;line-height:1.2;padding:4px 7px;gap:5px}
.document-view-filter-dropdown-panel{max-width:min(420px,calc(100vw - 8px));background:var(--meo-ui-surface-raised);border-color:var(--meo-ui-border-float)}
.document-view-filter-dropdown-panel .preview-dropdown-option{white-space:normal;overflow-wrap:anywhere;font-size:var(--meo-user-editor-font-size,var(--meo-font-live-size,16px))}
.document-view-toolbar .document-view-tool{flex:0 0 28px;width:28px;height:28px}
.document-view-tool-separator{flex:0 0 1px;height:14px;margin:0 4px;background:var(--meo-ui-separator)}
.document-view-toolbar .document-view-tool svg{width:18px;height:18px;stroke-width:1.75}
.document-view-toolbar.is-header .document-view-tool{flex-basis:24px;width:24px;height:24px}
.document-view-toolbar.is-header .document-view-tool svg{width:16px;height:16px;stroke-width:1.5}
.document-view-tool svg{width:16px;height:16px;pointer-events:none}
.document-view-tool:focus-visible{outline:2px solid var(--meo-ui-focus);outline-offset:-2px}
.document-view-tool:disabled{opacity:.4;cursor:default}
.mm-view-canvas{position:relative;flex:1;min-height:0;overflow:hidden}
.document-view-loading{z-index:0;color:var(--meo-view-foreground);background:var(--meo-view-background)}
.mm-view-empty{margin:auto;text-align:center;color:var(--meo-view-muted-foreground);line-height:1.8;padding:24px}
[data-document-view-side]{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
[data-document-view-side]>.editor-host,[data-document-view-side]>.preview-host{grid-area:1 / 1!important}
`;
