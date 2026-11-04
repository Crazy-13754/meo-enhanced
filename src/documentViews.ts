/** Version 1: trusted, installed VS Code extensions may contribute read-only document views. */
export interface DocumentViewRegistration {
  readonly id: string;
  readonly label: string;
  readonly labelZh?: string;
  /** Optional monochrome SVG paths in a 24x24 viewBox. The host owns size, color and button states. */
  readonly iconPaths?: readonly string[];
  /** Optional optical correction in toolbar pixels, at most 1px per axis. */
  readonly iconOffset?: { readonly x: number; readonly y: number };
  /** Path relative to the contributing extension, inside dist/. */
  readonly entry: string;
  /** Optional fenced languages rendered by mountBlock. Built-in languages cannot be replaced. */
  readonly codeBlockLanguages?: readonly string[];
}
export interface DocumentViewsApi {
  readonly version: 1;
  registerDocumentView(extensionId: string, view: DocumentViewRegistration): { dispose(): void };
  /** Register fenced blocks without a whole-document view or toolbar entry. */
  registerCodeBlockRenderer?(extensionId: string, view: DocumentViewRegistration & { readonly codeBlockLanguages: readonly string[] }): { dispose(): void };
  /** Register metadata even when disabled. Activation must return all owned registrations. */
  registerFeature?(extensionId: string, feature: { readonly id: string; readonly orderId?: number; readonly label: string; readonly labelZh?: string; readonly description?: string; readonly descriptionZh?: string },
    activate: () => { dispose(): void }): { dispose(): void };
}
export interface DocumentViewSnapshot { readonly text: string; readonly revision: number }
export interface DocumentViewContext {
  readonly language: string;
  /** Host-owned ordinary Markdown; safe, inert HTML with one-based inclusive source ranges.
   * Apply contentClass to label roots to share document styles. No Preview preset, assets or scripts. */
  readonly contentClass?: string;
  renderContent?(snapshot: DocumentViewSnapshot): Promise<{ readonly html: string }>;
  /** Unobstructed area in canvas-local CSS pixels, excluding host overlay controls. Read when fitting content. */
  getAvailableViewport?(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** One-based source line. Navigation never edits the document. */
  revealLine(line: number): void;
  /** Optional selection notification for the host's one-shot alignment controls. */
  selectionChanged?(line: number | null): void;
}
export interface DocumentViewInstance {
  /** Refresh owned labels/status without reparsing or resetting view state. */
  setLanguage?(language: string): void;
  /** Optional view operations rendered by the host beside layout and close controls. */
  readonly actions?: readonly DocumentViewAction[];
  update(snapshot: DocumentViewSnapshot): void | Promise<void>;
  /** Reveal the view content associated with a one-based source line. */
  revealLine?(line: number): void | Promise<void>;
  dispose(): void;
}
export interface DocumentViewAction {
  readonly id: string;
  readonly label: string;
  readonly labelZh?: string;
  readonly iconPaths: readonly string[];
  run(): void | Promise<void>;
}
export interface DocumentViewModule {
  readonly apiVersion: 1;
  mount?(container: HTMLElement, context: DocumentViewContext): DocumentViewInstance;
  /** Static SVG renderers delegate their entire canvas to the host. */
  createSvgRenderer?(): DocumentSvgRenderer;
  /** Optional static export adapter. SVG-only modules reuse createSvgRenderer automatically. */
  createBlockExportRenderer?(context: DocumentBlockExportContext): DocumentBlockExportRenderer;
  mountBlock?(container: HTMLElement, context: DocumentBlockContext): DocumentViewInstance;
}

/** Ephemeral camera for one live block; never serialized or shared with fullscreen. */
export interface DocumentBlockCamera {
  value?: { scale: number; x: number; y: number };
}

/** Preview inline results are static. Viewing gestures never edit source. */
export interface DocumentBlockContext extends DocumentViewContext {
  /** SVG renderers may mark their complete untransformed result group with
   * data-meo-image-content for host-owned PNG copying, independently of camera fit. */
  readonly interactive: boolean;
  /** Inline scrolling belongs to the document; fullscreen may consume wheel zoom. */
  readonly presentation: 'inline' | 'fullscreen';
  /** Keep the user's scale and content point at canvas center across editor layouts. */
  readonly camera?: DocumentBlockCamera;
  /** Unscaled rendered bounds in CSS pixels. Host owns inline height and its limits. */
  reportContentSize?(size: { readonly width: number; readonly height: number }): void;
  readonly viewState?: unknown;
  /** Small JSON viewing state, scoped to this block; do not store source, camera or HTML. */
  saveViewState(state: unknown): void;
}

export interface DocumentSvgAppearance {
  readonly language: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly foreground: string;
  readonly background: string;
  readonly dark: boolean;
}
export interface DocumentSvgRenderer {
  render(snapshot: DocumentViewSnapshot, appearance: DocumentSvgAppearance): Promise<string>;
  dispose(): void;
}

export type DocumentBlockExportArtifact = {
  readonly kind: 'svg' | 'png';
  /** Self-contained SVG markup, or base64 PNG bytes (without a data URL prefix). */
  readonly data: string;
  readonly width: number;
  readonly height: number;
};
export interface DocumentBlockExportContext {
  /** Host-owned, attached measurement container, isolated from the interactive document. */
  readonly container: HTMLElement;
  readonly appearance: DocumentSvgAppearance;
  readonly contentClass: string;
  readonly signal: AbortSignal;
  renderContent(snapshot: DocumentViewSnapshot): Promise<{ readonly html: string }>;
  /** Freeze computed styles and full artwork bounds, removing the viewing camera. */
  captureSvg(svg: SVGSVGElement): DocumentBlockExportArtifact;
}
export interface DocumentBlockExportRenderer {
  render(snapshot: DocumentViewSnapshot & { readonly language: string }): Promise<DocumentBlockExportArtifact>;
  dispose(): void;
}
