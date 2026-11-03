export const documentViewStyles = `
.mm-view-panel{--meo-view-font-family:var(--meo-font-live,var(--vscode-editor-font-family,monospace));--meo-view-font-size:var(--meo-user-editor-font-size,var(--meo-font-live-size,16px));--meo-view-font-weight:var(--meo-font-live-weight,400);--meo-view-code-font-family:var(--meo-font-source,var(--vscode-editor-font-family,monospace));position:absolute;inset:40px 0 0;z-index:240;display:flex;flex-direction:column;background:var(--meo-view-background,var(--meo-background));color:var(--meo-view-foreground,var(--meo-foreground));font:13px var(--vscode-font-family,system-ui)}
.mm-view-panel[hidden]{display:none}
.mm-view-panel.is-side{position:relative;inset:auto;grid-area:1 / 2;min-width:0;min-height:0;border-left:1px solid var(--meo-ui-separator)}
.document-view-toolbar{position:absolute;z-index:1;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;flex-wrap:nowrap;gap:4px;max-width:calc(100% - 16px);box-sizing:border-box;padding:4px;overflow-x:auto;white-space:nowrap;border:1px solid var(--meo-ui-border-float);border-radius:8px;background:var(--meo-ui-surface);box-shadow:0 2px 8px #0002}
.document-view-toolbar[hidden]{display:none}
.document-view-toolbar .document-view-tool{flex:0 0 28px;width:28px;height:28px}
.document-view-tool svg{width:16px;height:16px;pointer-events:none}
.document-view-tool:focus-visible{outline:2px solid var(--meo-ui-focus);outline-offset:-2px}
.document-view-tool:disabled{opacity:.4;cursor:default}
.mm-view-canvas{position:relative;flex:1;min-height:0;overflow:hidden}
.mm-view-empty{margin:auto;text-align:center;color:var(--meo-view-muted-foreground);line-height:1.8;padding:24px}
[data-document-view-side]{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
[data-document-view-side]>.editor-host,[data-document-view-side]>.preview-host{grid-area:1 / 1!important}
`;
