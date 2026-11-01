import { EditorView, WidgetType } from '@codemirror/view';
import type { ChangeDesc } from '@codemirror/state';
import { mapLiveWidgetPositions } from '../editor/liveWidgetPositions';
import { AppWindow, createElement, ExternalLink, Maximize2, RefreshCw, SquareArrowRightEnter } from 'lucide';
import { getViewportController } from './viewportController';
import { createImageResolutionTransport, type ImageResolutionTransport } from '../adapters/imageResolutionTransport';
import { createClipboardImageSaveTransport, type ClipboardImageSaveTransport } from '../adapters/clipboardImageSaveTransport';
import type { ResolvedImageSrcResponse } from '../../../src/protocol/imageResolution';
import type { SavedImagePathResponse } from '../../../src/protocol/clipboardImageSave';
import type {
  ImagePresentationFactory,
  ImagePresentationHandle
} from '../editor/imagePresentation';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { encodeMarkdownPath } from '../../../src/foundation/linkDestination';
import { isWikiImageTarget, parseWikiReference, wikiImageSrc, wikiTargetFromImageSrc, WIKI_IMAGE_SCHEME } from '../../../src/foundation/wikiReference';
import { openImageFullscreen, type ImageFullscreenViewer } from './imageFullscreen';
import { getEnclosingSourceLinkHref, hrefFromSourceLinkNode, isPrimaryModifierPointerClick } from './linkNavigation';

const wikiImageIssues = new Map<string, string>();
const wikiIssueRequests = new Map<string, number>();
let wikiIssueRequestId = 0;
type WikiImagePresentation = { url: string; handle: ImagePresentationHandle; reportIssue: (issue?: string) => void };
const wikiImagePresentations = new Set<WikiImagePresentation>();

function reportWikiImageIssue(url: string, issue?: string): void {
  if (issue) wikiImageIssues.set(url, issue); else wikiImageIssues.delete(url);
  for (const presentation of wikiImagePresentations) if (presentation.url === url) presentation.reportIssue(issue);
}

export function refreshWikiImagePresentations(): void {
  wikiImageIssues.clear();
  wikiIssueRequests.clear();
  for (const presentation of wikiImagePresentations) void presentation.handle.refresh({ resourceChanged: true });
}

const IMAGE_EXT_RE = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:$|[?#])/i;

type ImageSrcResolver = (
  url: string,
  signal?: AbortSignal
) => string | Promise<string | null | undefined> | null | undefined;

let imageSrcResolver: ImageSrcResolver = (url) => url;
let vscodeApi: any = null;
let imageResolutionTransport: ImageResolutionTransport = {
  resolve: async () => ({
    ok: false,
    error: { code: 'operation-failed', message: 'Image handling is not initialized' }
  }),
  accept: () => false
};
let clipboardImageSaveTransport: ClipboardImageSaveTransport = {
  save: async () => ({
    ok: false,
    error: { code: 'operation-failed', message: 'Image handling is not initialized' }
  }),
  accept: () => false
};

const IMAGE_DOUBLE_CLICK_WINDOW_MS = 400;
const IMAGE_DOUBLE_CLICK_MAX_DISTANCE_PX = 8;
const IMAGE_PRESENTATION_DISPOSE_EVENT = 'meo-dispose-image-presentation';
type ImageMount = {
  disposed: boolean;
  url: string;
  sourceFrom: () => number | null;
  presentationHandle: ImagePresentationHandle | null;
  wikiPresentation?: WikiImagePresentation;
  fullscreenViewer: ImageFullscreenViewer | null;
};
type ImageElement = HTMLElement & { __meoImageMount?: ImageMount };
type ImageDoubleClickCandidate = {
  x: number;
  y: number;
  openFullscreen: () => void;
  timeout: number;
};
let pendingImageDoubleClick: ImageDoubleClickCandidate | null = null;
let imageDoubleClickListenerInitialized = false;

const imageExtensionByMime: Record<string, string> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/icon': 'ico',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'image/x-icon': 'ico'
};

export function initializeImageHandling(vscode: any): void {
  vscodeApi = vscode;
  imageResolutionTransport = createImageResolutionTransport((message) => {
    vscodeApi?.postMessage(message);
  });
  clipboardImageSaveTransport = createClipboardImageSaveTransport((message) => {
    vscodeApi?.postMessage(message);
  });
  if (imageDoubleClickListenerInitialized) return;
  imageDoubleClickListenerInitialized = true;
  window.addEventListener('click', (event) => {
    const pending = pendingImageDoubleClick;
    if (!pending) return;
    clearPendingImageDoubleClick();
    if (
      event.ctrlKey ||
      event.metaKey ||
      Math.abs(event.clientX - pending.x) > IMAGE_DOUBLE_CLICK_MAX_DISTANCE_PX ||
      Math.abs(event.clientY - pending.y) > IMAGE_DOUBLE_CLICK_MAX_DISTANCE_PX
    ) return;
    event.preventDefault();
    event.stopPropagation();
    pending.openFullscreen();
  }, true);
}

function clearPendingImageDoubleClick(): void {
  if (!pendingImageDoubleClick) return;
  window.clearTimeout(pendingImageDoubleClick.timeout);
  pendingImageDoubleClick = null;
}

function registerImageDoubleClickCandidate(event: MouseEvent, openFullscreen: () => void): void {
  clearPendingImageDoubleClick();
  const pending = {
    x: event.clientX,
    y: event.clientY,
    openFullscreen,
    timeout: window.setTimeout(clearPendingImageDoubleClick, IMAGE_DOUBLE_CLICK_WINDOW_MS)
  };
  pendingImageDoubleClick = pending;
}

const openImageExternally = (url: string): void => {
  vscodeApi?.postMessage({ type: 'openImageExternally', url });
};

const isImmediateImageSrc = (url: string): boolean => /^(?:https?:|data:|blob:|vscode-webview:|vscode-webview-resource:|vscode-resource:)/i.test(url);

const requestImageSrcResolution = async (url: string, signal?: AbortSignal): Promise<string> => {
  const requestId = url.startsWith(WIKI_IMAGE_SCHEME) ? ++wikiIssueRequestId : null;
  if (requestId !== null) wikiIssueRequests.set(url, requestId);
  const result = await imageResolutionTransport.resolve(url, signal);
  if (url.startsWith(WIKI_IMAGE_SCHEME)) {
    const current = wikiIssueRequests.get(url) === requestId;
    if (current) wikiIssueRequests.delete(url);
    if (!result.ok) {
      if (current && !signal?.aborted) reportWikiImageIssue(url, result.error.message);
      throw new Error(result.error.message);
    }
    if (current && !signal?.aborted) reportWikiImageIssue(url);
    return result.value.resolvedUrl;
  }
  const resolvedUrl = result.ok === true ? result.value.resolvedUrl : '';
  return resolvedUrl || url;
};

export const resolveEmbeddedImageSrc = async (rawUrl: string, signal?: AbortSignal): Promise<string> => {
  const url = rawUrl.trim();
  if (!url) return '';
  const result = await imageResolutionTransport.resolve(url, signal, 'embedded');
  return result.ok === true ? result.value.resolvedUrl : '';
};

export const settleImageSrcRequest = (message: ResolvedImageSrcResponse): void => {
  imageResolutionTransport.accept(message);
};

export const resolveImageSrc = (
  rawUrl: string | null | undefined,
  signal?: AbortSignal
): string | Promise<string> => {
  const url = (rawUrl ?? '').trim();
  if (!url || isImmediateImageSrc(url)) {
    return url;
  }
  return requestImageSrcResolution(url, signal);
};

export const resolveConfiguredImageSrc = async (
  rawUrl: string,
  signal?: AbortSignal
): Promise<string | null> => {
  const resolved = await imageSrcResolver(rawUrl, signal);
  return resolved || null;
};

export const parseDataUrlMimeType = (dataUrl: string): string => {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1]?.toLowerCase() ?? '';
};

const fallbackImageExtensionFromMimeType = (mimeType: string): string => {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized.startsWith('image/')) {
    return '';
  }

  const subtype = normalized.slice('image/'.length).replace(/\+xml$/, '').replace(/^x-/, '');
  const sanitized = subtype.replace(/[^a-z0-9.+-]/g, '');
  return sanitized || '';
};

export const imageExtensionFromMimeType = (mimeType: string): string => (
  imageExtensionByMime[mimeType.trim().toLowerCase()] ?? fallbackImageExtensionFromMimeType(mimeType)
);

export const handleSavedImagePath = (message: SavedImagePathResponse): void => {
  clipboardImageSaveTransport.accept(message);
};

export interface ImagePasteContext {
  lineNumber: number;
  lineOffset: number;
  onError?: (message: string, retry: () => Promise<boolean>) => void;
}

export const handleImagePaste = async (
  event: ClipboardEvent,
  editor: any,
  context: ImagePasteContext
): Promise<boolean> => {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return false;
  }

  const imageCandidates: Array<{ blob: Blob; mimeType: string }> = [];
  for (const item of Array.from(clipboardData.items ?? [])) {
    if (!item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if (blob) imageCandidates.push({ blob, mimeType: item.type });
  }
  if (imageCandidates.length === 0) {
    for (const file of Array.from(clipboardData.files ?? [])) {
      if (file.type.startsWith('image/')) imageCandidates.push({ blob: file, mimeType: file.type });
    }
  }
  if (imageCandidates.length === 0) return false;

  const tableInput = document.activeElement instanceof HTMLTextAreaElement &&
    document.activeElement.closest('.meo-md-html-table')
    ? document.activeElement
    : null;
  const tableSelection = tableInput
    ? {
        start: tableInput.selectionStart ?? 0,
        end: tableInput.selectionEnd ?? tableInput.selectionStart ?? 0
      }
    : null;
  const tableTextAtPaste = tableInput?.value ?? null;
  const documentAtPaste = editor.view.state.doc;

  for (const { blob, mimeType } of imageCandidates) {
    event.preventDefault();
    event.stopPropagation();
    let imageData = '';
    let savedImage: { readonly fileName: string; readonly path: string } | null = null;
    let completed = false;
    const pasteImage = async (): Promise<boolean> => {
      if (completed) return true;
      try {
        if (!imageData) {
          imageData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image'));
            reader.readAsDataURL(blob);
          });
          if (!imageData) throw new Error('Failed to read pasted image');
        }
        if (!savedImage) {
          const extension = imageExtensionFromMimeType(parseDataUrlMimeType(imageData)) ||
            imageExtensionFromMimeType(mimeType) || 'png';
          const result = await clipboardImageSaveTransport.save({ imageData, extension });
          if (result.ok === false) throw new Error(result.error.message);
          savedImage = result.value;
        }
        const markdownPath = encodeMarkdownPath(savedImage.path);
        const altText = savedImage.fileName.replace(/[\\`*_[\]<>&]/g, '\\$&');
        const imageMarkdown = `![${altText}](${markdownPath})`;
        if (tableInput && tableSelection && tableInput.isConnected) {
          const start = tableInput.value === tableTextAtPaste
            ? tableSelection.start : tableInput.selectionStart;
          const end = tableInput.value === tableTextAtPaste
            ? tableSelection.end : tableInput.selectionEnd;
          tableInput.setRangeText(imageMarkdown, start, end, 'end');
          completed = true;
          tableInput.dispatchEvent(new Event('input', { bubbles: true }));
          tableInput.focus({ preventScroll: true });
          return true;
        }
        const currentState = editor.view.state;
        let insertAt = currentState.selection.main.head;
        if (currentState.doc === documentAtPaste) {
          const targetLineNumber = Math.min(context.lineNumber, currentState.doc.lines);
          const targetLine = currentState.doc.line(targetLineNumber);
          insertAt = Math.min(targetLine.to, targetLine.from + context.lineOffset);
        }
        editor.view.dispatch({
          changes: { from: insertAt, to: insertAt, insert: imageMarkdown },
          selection: { anchor: insertAt + imageMarkdown.length }
        });
        completed = true;
        editor.focus();
        return true;
      } catch (error) {
        if (completed) return true;
        console.error('[MEO image paste]', error);
        context.onError?.(error instanceof Error ? error.message : 'Failed to paste image', pasteImage);
        return false;
      }
    };
    await pasteImage();
    return true;
  }

  return false;
};

export function setImageSrcResolver(resolver: ImageSrcResolver): void {
  imageSrcResolver = typeof resolver === 'function' ? resolver : ((url) => url);
}

export function isImageUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }
  return IMAGE_EXT_RE.test(url);
}

export class ImageWidget extends WidgetType {
  [mapLiveWidgetPositions](changes: ChangeDesc): WidgetType {
    const from = this.sourceFrom;
    if (from === null || this.sourceFromResolver) return this;
    const mapped = changes.mapPos(from, 1);
    return mapped === from ? this : new ImageWidget(this.url, this.altText, this.linkUrl, mapped, this.presentationFactory,
      { pointerInteractionOwner: this.pointerInteractionOwner, uiLanguage: this.uiLanguage, width: this.width, height: this.height,
        displayImageStyle: this.displayImageStyle });
  }
  readonly width?: number;
  readonly height?: number;
  private readonly displayImageStyle: string;
  url: string;
  altText: string;
  linkUrl: string;
  private readonly initialSourceFrom: number | null;
  private readonly sourceFromResolver?: () => number | null;
  pointerInteractionOwner: 'widget' | 'parent';
  uiLanguage: UiLanguage;

  constructor(
    url: string | null | undefined,
    altText: string | null | undefined,
    linkUrl: string | null | undefined,
    sourceFrom: number | null = null,
    readonly presentationFactory: ImagePresentationFactory,
    options: {
      pointerInteractionOwner?: 'widget' | 'parent';
      uiLanguage?: UiLanguage;
      sourceFromResolver?: () => number | null;
      width?: number;
      height?: number;
      /** Validated HTML image paint properties; applied to every loaded/fallback clone. */
      displayImageStyle?: string;
    } = {}
  ) {
    super();
    this.url = url?.trim() ?? '';
    this.altText = altText ?? '';
    this.linkUrl = linkUrl?.trim() ?? '';
    this.initialSourceFrom = Number.isInteger(sourceFrom) ? sourceFrom : null;
    this.sourceFromResolver = options.sourceFromResolver;
    this.width = options.width;
    this.height = options.height;
    this.displayImageStyle = options.displayImageStyle ?? '';
    this.pointerInteractionOwner = options.pointerInteractionOwner ?? 'widget';
    this.uiLanguage = options.uiLanguage ?? 'en';
    if (this.url) {
      void this.presentationFactory.preload(this.url);
    }
  }

  eq(other: ImageWidget): boolean {
    return (
      other instanceof ImageWidget &&
      other.url === this.url &&
      other.altText === this.altText &&
      other.linkUrl === this.linkUrl &&
      other.width === this.width && other.height === this.height &&
      other.displayImageStyle === this.displayImageStyle &&
      other.sourceFrom === this.sourceFrom &&
      other.pointerInteractionOwner === this.pointerInteractionOwner &&
      other.uiLanguage === this.uiLanguage
    );
  }

  toDOM(view?: EditorView): HTMLElement {
    const container: ImageElement = document.createElement('div');
    const mount: ImageMount = {
      disposed: false, url: this.url, sourceFrom: () => this.sourceFrom, presentationHandle: null,
      fullscreenViewer: null
    };
    container.__meoImageMount = mount;
    container.className = 'meo-md-image';
    if (this.url.startsWith(WIKI_IMAGE_SCHEME)) container.dataset.tooltipKind = 'description';

    if (this.linkUrl) {
      container.classList.add('meo-md-image-linked');
      container.setAttribute('data-meo-link-href', this.linkUrl);
    }

    if (!this.url) {
      this.renderFallback(container);
      return container;
    }
    if (this.pointerInteractionOwner === 'widget') {
      this.attachImagePointerInteractions(container, mount, view);
    }

    const presentationHandle = this.presentationFactory.create({
      showFallback: () => {
        if (mount.disposed) return false;
        this.renderFallback(container);
        return true;
      },
      showImage: (loadedImage) => {
        if (mount.disposed) return false;
        const image = this.createDisplayImage(loadedImage);
        delete container.dataset.tooltip;
        container.classList.remove('meo-md-image-fallback');
        container.replaceChildren(image, this.createImageControls(image, mount));
        return true;
      },
      preserveLayoutChange: (apply) => this.preserveImageLayoutChange(container, view, apply),
      isVisible: () => {
        if (mount.disposed || !container.isConnected) return false;
        const bounds = container.getBoundingClientRect();
        const viewport = view?.scrollDOM.getBoundingClientRect() ?? {
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          left: 0
        };
        return bounds.bottom > viewport.top
          && bounds.top < viewport.bottom
          && bounds.right > viewport.left
          && bounds.left < viewport.right;
      }
    });
    mount.presentationHandle = presentationHandle;
    const wikiPresentation = { url: this.url, handle: presentationHandle, reportIssue: (issue?: string) => {
      if (mount.disposed) return;
      if (issue) container.dataset.tooltip = issue; else delete container.dataset.tooltip;
    } };
    if (this.url.startsWith(WIKI_IMAGE_SCHEME)) {
      wikiImagePresentations.add(wikiPresentation);
      mount.wikiPresentation = wikiPresentation;
    }
    container.addEventListener(IMAGE_PRESENTATION_DISPOSE_EVENT, () => {
      this.destroy(container);
    }, { once: true });
    presentationHandle.present(this.fallbackText(), this.url);
    return container;
  }

  createDisplayImage(cachedImage: HTMLImageElement): HTMLImageElement {
    const img = cachedImage.cloneNode(false) as HTMLImageElement;
    img.className = 'meo-md-image-img';
    img.alt = this.altText;
    img.loading = 'eager';
    const width = cachedImage.naturalWidth || cachedImage.width, height = cachedImage.naturalHeight || cachedImage.height;
    const intrinsic = this.presentationFactory.getIntrinsicSize(this.url) ?? (width > 0 && height > 0 ? { width, height } : null);
    this.applyDisplayImageSize(img, intrinsic);
    return img;
  }

  private applyDisplayImageSize(img: HTMLImageElement, intrinsic: { width: number; height: number } | null): void {
    if (intrinsic) {
      // cloneNode retains src, but not the decoded resource's intrinsic box.
      // Reserve the same constrained geometry before the clone's load event.
      img.width = intrinsic.width;
      img.height = intrinsic.height;
      img.style.aspectRatio = `${intrinsic.width} / ${intrinsic.height}`;
      if (!this.width && !this.height) img.style.width = `var(--meo-html-image-width, ${intrinsic.width * Math.min(1, 240 / intrinsic.height)}px)`;
    }
    if (this.width) { img.width = this.width; img.style.width = `${this.width}px`; }
    if (this.height) { img.height = this.height; img.style.height = `${this.height}px`; }
    if (this.displayImageStyle) img.style.cssText += `; ${this.displayImageStyle}`;
  }

  private attachImagePointerInteractions(container: HTMLElement, mount: ImageMount, view?: EditorView): void {
    const isControlTarget = (target: EventTarget | null) => (
      target instanceof Element && target.closest('.meo-md-image-controls') !== null
    );
    const activateSource = () => {
      if (this.sourceFrom === null) return;
      container.dispatchEvent(new CustomEvent('meo-activate-image', {
        bubbles: true,
        detail: { from: this.sourceFrom }
      }));
    };
    container.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isControlTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        // This widget opens on click; do not also navigate through CodeMirror's
        // pointerdown handler before the same gesture reaches the widget.
        if (this.linkUrl && isPrimaryModifierPointerClick(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });
    container.addEventListener('click', (event) => {
      if (isControlTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (isPrimaryModifierPointerClick(event)) this.openLinkedImage(container);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const img = container.querySelector<HTMLImageElement>('.meo-md-image-img');
      const sourceFrom = this.sourceFrom;
      const openFullscreen = () => {
        // The first click can reveal source and replace this DOM. Complete the
        // existing double-click intent through the current mount of that image.
        const current = !mount.disposed ? mount : Array.from(
          view?.dom.querySelectorAll<ImageElement>('.meo-md-image') ?? []
        ).map(element => element.__meoImageMount).find(candidate =>
          candidate && !candidate.disposed && candidate.url === this.url && candidate.sourceFrom() === sourceFrom
        );
        if (current) this.openFullscreen(img?.currentSrc || img?.src || this.url, current);
      };
      activateSource();
      registerImageDoubleClickCandidate(event, openFullscreen);
    });
  }

  openLinkedImage(target: HTMLElement): void {
    if (!this.linkUrl) return;
    target.dispatchEvent(new CustomEvent('meo-open-link', {
      bubbles: true,
      detail: { href: this.linkUrl }
    }));
  }

  preserveImageLayoutChange(
    container: HTMLElement,
    view: EditorView | undefined,
    apply: () => boolean
  ): boolean | Promise<boolean> {
    if (!view || !container.isConnected) {
      return apply();
    }

    const controller = getViewportController(view);
    const sourceFrom = this.sourceFrom;
    if (controller && sourceFrom !== null) {
      return new Promise<boolean>((resolve, reject) => {
        controller.preserveLayoutChange({
          element: container,
          from: sourceFrom,
          to: sourceFrom
        }, () => {
          try {
            resolve(apply());
          } catch (error) {
            reject(error);
          }
        });
      });
    }
    const projected = apply();
    view.requestMeasure();
    return projected;
  }

  get sourceFrom(): number | null {
    return this.sourceFromResolver ? this.sourceFromResolver() : this.initialSourceFrom;
  }

  fallbackText(): string {
    const wikiTarget = wikiTargetFromImageSrc(this.url);
    if (wikiTarget !== null) return `![[${wikiTarget}${this.width ? `|${this.width}${this.height ? `x${this.height}` : ''}` : ''}]]`;
    return `![${this.altText}](${this.url})`;
  }

  private createImageControls(img: HTMLImageElement, mount: ImageMount): HTMLElement {
    const strings = getUiStrings(this.uiLanguage);
    const controls = document.createElement('div');
    controls.className = 'meo-visual-controls meo-md-image-controls';

    if (this.linkUrl) {
      const isDocumentFragment = this.linkUrl.startsWith('#');
      const openLink = document.createElement('button');
      openLink.type = 'button';
      openLink.className = 'meo-visual-control-btn meo-md-image-control-btn';
      openLink.dataset.tooltip = this.linkUrl;
      openLink.dataset.tooltipLinkHref = this.linkUrl;
      openLink.dataset.tooltipKind = 'description';
      openLink.setAttribute('aria-label', isDocumentFragment ? strings.jumpWithinDocument : strings.openLink);
      openLink.appendChild(createElement(isDocumentFragment ? SquareArrowRightEnter : ExternalLink, { width: 16, height: 16 }));
      openLink.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openLinkedImage(openLink);
      });
      controls.appendChild(openLink);
    }

    const openExternally = document.createElement('button');
    openExternally.type = 'button';
    openExternally.className = 'meo-visual-control-btn meo-md-image-control-btn';
    openExternally.dataset.tooltip = strings.openWithSystemApp;
    openExternally.setAttribute('aria-label', strings.openWithSystemApp);
    openExternally.appendChild(createElement(AppWindow, { width: 16, height: 16 }));
    openExternally.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageExternally(this.url);
    });

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'meo-visual-control-btn meo-md-image-control-btn';
    refresh.dataset.tooltip = strings.refreshImage;
    refresh.setAttribute('aria-label', strings.refreshImage);
    refresh.appendChild(createElement(RefreshCw, { width: 16, height: 16 }));
    refresh.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (refresh.disabled) return;
      const refreshWork = mount.presentationHandle?.refresh();
      if (!refreshWork) return;
      refresh.disabled = true;
      void refreshWork.finally(() => {
        if (refresh.isConnected) refresh.disabled = false;
      });
    });

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'meo-visual-control-btn meo-md-image-control-btn';
    fullscreen.dataset.tooltip = strings.fullscreenImage;
    fullscreen.setAttribute('aria-label', strings.fullscreenImage);
    fullscreen.appendChild(createElement(Maximize2, { width: 16, height: 16 }));
    fullscreen.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openFullscreen(img.currentSrc || img.src, mount);
    });

    controls.append(refresh, openExternally, fullscreen);
    return controls;
  }

  private openFullscreen(src: string, mount: ImageMount): void {
    if (!src || mount.disposed || mount.fullscreenViewer) return;
    clearPendingImageDoubleClick();
    mount.fullscreenViewer = openImageFullscreen({
      src, alt: this.altText, uiLanguage: this.uiLanguage, pointerDriven: true,
      onClose: () => { mount.fullscreenViewer = null; }
    });
  }

  private closeFullscreen(mount: ImageMount): void {
    mount.fullscreenViewer?.close();
    mount.fullscreenViewer = null;
  }

  renderFallback(container: HTMLElement): void {
    container.classList.add('meo-md-image-fallback');
    const issue = wikiImageIssues.get(this.url);
    if (issue) container.dataset.tooltip = issue;
    const intrinsicSize = this.url ? this.presentationFactory.getIntrinsicSize(this.url) : null;
    if (intrinsicSize || (this.width && this.height)) {
      const placeholder = document.createElement('img');
      placeholder.className = 'meo-md-image-size-placeholder';
      placeholder.alt = this.fallbackText();
      if (!this.linkUrl) {
        placeholder.dataset.tooltip = this.fallbackText();
        placeholder.dataset.tooltipKind = 'description';
      }
      placeholder.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
      this.applyDisplayImageSize(placeholder, intrinsicSize);
      container.replaceChildren(placeholder);
      return;
    }
    const fallback = document.createElement('code');
    fallback.className = 'meo-md-image-fallback-text';
    fallback.textContent = this.fallbackText();
    container.replaceChildren(fallback);
  }

  ignoreEvent(event: Event): boolean {
    if (event.type.startsWith('pointer') || event.type.startsWith('mouse')) {
      return false;
    }
    return true;
  }

  destroy(dom: HTMLElement): void {
    const container = dom as ImageElement;
    const mount = container.__meoImageMount;
    if (!mount) return;
    delete container.__meoImageMount;
    mount.disposed = true;
    if (mount.wikiPresentation) wikiImagePresentations.delete(mount.wikiPresentation);
    mount.wikiPresentation = undefined;
    mount.presentationHandle?.dispose();
    mount.presentationHandle = null;
    this.closeFullscreen(mount);
  }
}

/** Disposes nested image projections before an owning widget replaces their DOM. */
export function disposeImagePresentations(root: ParentNode): void {
  if (root instanceof HTMLElement && root.classList.contains('meo-md-image')) {
    root.dispatchEvent(new Event(IMAGE_PRESENTATION_DISPOSE_EVENT));
  }
  for (const image of root.querySelectorAll<HTMLElement>('.meo-md-image')) {
    image.dispatchEvent(new Event(IMAGE_PRESENTATION_DISPOSE_EVENT));
  }
}

export interface ImageGroupItem {
  url: string;
  altText: string;
  linkUrl: string;
  sourceFrom: number;
  width?: number;
  height?: number;
}

export class ImageGroupWidget extends WidgetType {
  [mapLiveWidgetPositions](changes: ChangeDesc): WidgetType {
    const items = this.items.map(item => ({ ...item, sourceFrom: changes.mapPos(item.sourceFrom, 1) }));
    return items.every((item, index) => item.sourceFrom === this.items[index].sourceFrom) ? this
      : new ImageGroupWidget(items, this.presentationFactory, this.uiLanguage);
  }
  readonly items: readonly ImageGroupItem[];
  private readonly widgets: ImageWidget[];

  constructor(
    items: readonly ImageGroupItem[],
    private readonly presentationFactory: ImagePresentationFactory,
    private readonly uiLanguage: UiLanguage = 'en'
  ) {
    super();
    this.items = items.map((item) => ({ ...item }));
    this.widgets = this.items.map((item) => new ImageWidget(
      item.url,
      item.altText,
      item.linkUrl,
      item.sourceFrom,
      presentationFactory,
      { uiLanguage, width: item.width, height: item.height }
    ));
  }

  eq(other: ImageGroupWidget): boolean {
    return (
      other instanceof ImageGroupWidget
      && other.items.length === this.items.length
      && other.items.every((item, index) => {
        const current = this.items[index];
        return (
          item.url === current.url
          && item.altText === current.altText
          && item.linkUrl === current.linkUrl
          && item.width === current.width && item.height === current.height
          && item.sourceFrom === current.sourceFrom
        );
      })
    );
  }

  toDOM(view?: EditorView): HTMLElement {
    const group = document.createElement('div');
    group.className = 'meo-md-image-group';
    group.append(...this.widgets.map((widget) => widget.toDOM(view)));
    return group;
  }

  ignoreEvent(event: Event): boolean {
    if (event.type.startsWith('pointer') || event.type.startsWith('mouse')) {
      return false;
    }
    return true;
  }

  destroy(dom: HTMLElement): void {
    disposeImagePresentations(dom);
  }
}

function findChildNode(node: any, name: string): any {
  for (let child = (node.node ?? node).firstChild; child; child = child.nextSibling) {
    if (child.name === name) {
      return child;
    }
  }
  return null;
}

function stripMarkdownImageTitle(url: string): string {
  const title = /^(.*?)\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\))\s*$/.exec(url);
  return (title?.[1] ?? url).trim();
}

export function getImageData(state: any, node: any): { url: string; altText: string; linkUrl: string; width?: number; height?: number } {
  const wiki = parseWikiReference(state.doc.sliceString(node.from, node.to));
  if (wiki?.embed && isWikiImageTarget(wiki.target)) return { url: wikiImageSrc(wiki.target), altText: wiki.label, linkUrl: '', width: wiki.width, height: wiki.height };
  const urlNode = findChildNode(node, 'URL');
  const rawUrl = urlNode ? state.doc.sliceString(urlNode.from, urlNode.to).trim() : hrefFromSourceLinkNode(state, node.node ?? node);
  const url = stripMarkdownImageTitle(rawUrl);

  let altText = '';
  const imageText = state.doc.sliceString(node.from, node.to);
  const altMatch = /!\[((?:\\.|[^\]\\])*)\]/.exec(imageText);
  if (altMatch) {
    altText = altMatch[1].replace(/\\([\\`*_[\]<>&])/g, '$1');
  }

  const linkUrl = getEnclosingSourceLinkHref(state, node.node ?? node);

  return { url, altText, linkUrl };
}
