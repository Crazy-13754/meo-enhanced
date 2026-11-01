import { AppWindow, createElement, Maximize2, RefreshCw } from 'lucide';
import { getUiStrings, type UiLanguage } from '../application/uiLanguage';
import { openImageFullscreen, type ImageFullscreenViewer } from './imageFullscreen';
import { focusRenderedBlockAction, suppressRenderedBlockPointerFocus } from './renderedBlockActionFocus';

type ImageActions = {
  image: HTMLImageElement;
  controls: HTMLElement;
  refresh: HTMLElement;
  fullscreen: HTMLElement;
  events: AbortController;
};

/** Reading controls remain outside image layout and are limited to mounted images. */
export function createPreviewImageActions(owner: Document, options: {
  language: () => UiLanguage;
  refresh: (image: HTMLImageElement) => Promise<void>;
  openExternally: (source: string) => void;
  reveal: (image: HTMLImageElement) => void;
}) {
  const records = new Map<HTMLImageElement, ImageActions>();
  const events = new AbortController();
  let viewer: ImageFullscreenViewer | null = null;
  let viewing: ImageActions | null = null;
  let hovered: ImageActions | null = null;
  let frame: number | null = null;
  const source = (image: HTMLImageElement) => image.dataset.meoPreviewImageSource ?? image.dataset.meoDeferredImageSrc ?? '';
  const strings = () => getUiStrings(options.language());
  const externalLabel = (image: HTMLImageElement) => /^https?:/i.test(source(image))
    ? strings().openImageInBrowser : strings().openWithSystemApp;
  const canOpenExternally = (image: HTMLImageElement) => !/^(?:data:|blob:)/i.test(source(image));
  const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
    && !image.hasAttribute('data-meo-deferred-image-src') && image.dataset.meoPreviewImageReady === 'true';
  const position = (record: ImageActions) => {
    const bounds = record.image.getBoundingClientRect();
    const width = owner.documentElement.clientWidth, height = owner.documentElement.clientHeight;
    const visible = bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.right > 0 && bounds.top < height && bounds.left < width;
    record.controls.hidden = !visible;
    if (!visible) return;
    record.controls.style.left = `${Math.max(8, Math.min(bounds.right - record.controls.offsetWidth - 5, width - record.controls.offsetWidth - 8))}px`;
    record.controls.style.top = `${Math.max(4, bounds.top + 4)}px`;
  };
  const schedulePosition = () => {
    if (frame !== null) return;
    frame = owner.defaultView!.requestAnimationFrame(() => {
      frame = null;
      for (const record of records.values()) if (record === hovered || record.controls.contains(owner.activeElement)) position(record);
    });
  };
  const resize = new (owner.defaultView as Window & typeof globalThis).ResizeObserver(schedulePosition);
  const hover = (record: ImageActions | null) => {
    if (hovered === record) return;
    if (hovered) { hovered.controls.removeAttribute('data-meo-image-hover'); resize.unobserve(hovered.image); }
    hovered = record;
    if (record) {
      position(record); resize.observe(record.image);
      record.controls.dataset.meoImageHover = 'true';
    }
  };
  owner.addEventListener('scroll', schedulePosition, { capture: true, passive: true, signal: events.signal });
  owner.defaultView!.addEventListener('resize', schedulePosition, { signal: events.signal });
  const remove = (record: ImageActions) => {
    if (viewing === record) viewer?.close();
    if (hovered === record) hover(null);
    record.events.abort(); record.controls.remove(); records.delete(record.image);
  };
  const reportFailure = (record: ImageActions) => {
    record.controls.querySelector('[role="status"]')?.remove();
    const status = owner.createElement('span');
    status.className = 'meo-preview-action-status'; status.setAttribute('role', 'status');
    status.textContent = strings().refreshImageFailed; record.controls.append(status);
  };
  const attach = (image: HTMLImageElement) => {
    const controls = owner.createElement('span');
    controls.className = 'meo-preview-code-actions meo-preview-image-actions';
    const imageEvents = new AbortController();
    const { signal } = imageEvents;
    const button = (icon: typeof RefreshCw, label: string, action: (pointer: boolean) => void) => {
      const element = owner.createElement('span');
      element.setAttribute('role', 'button'); element.tabIndex = 0;
      element.dataset.tooltip = label; element.setAttribute('aria-label', label);
      element.append(owner.importNode(createElement(icon, { width: 15, height: 15, 'aria-hidden': 'true' }), true));
      const activate = (event: Event) => {
        event.preventDefault(); event.stopPropagation();
        if (element.getAttribute('aria-disabled') !== 'true') action(event.type === 'click' && (event as MouseEvent).detail > 0);
      };
      element.addEventListener('mousedown', event => event.preventDefault(), { signal });
      element.addEventListener('click', activate, { signal });
      element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); }, { signal });
      controls.append(element);
      return element;
    };
    const refresh = button(RefreshCw, strings().refreshImage, () => {
      controls.querySelector('[role="status"]')?.remove();
      refresh.setAttribute('aria-disabled', 'true');
      void options.refresh(record.image).catch(() => {
        if (!signal.aborted) reportFailure(record);
      }).finally(() => {
        if (!signal.aborted) { refresh.setAttribute('aria-disabled', 'false'); update(record); }
      });
    });
    const external = button(AppWindow, externalLabel(image), () => options.openExternally(source(record.image)));
    external.setAttribute('aria-disabled', String(!canOpenExternally(image)));
    if (!canOpenExternally(image)) external.tabIndex = -1;
    const fullscreen = button(Maximize2, strings().fullscreenImage, pointerDriven => {
      if (!ready(record.image)) return;
      viewer = openImageFullscreen({
        src: record.image.currentSrc || record.image.src, alt: record.image.alt,
        uiLanguage: options.language(), pointerDriven,
        onClose: (userClosed, pointerExit) => {
          viewer = null; viewing = null;
          if (userClosed && record.image.isConnected) {
            position(record); focusRenderedBlockAction(fullscreen, pointerExit);
          }
        }
      });
      viewing = record;
    });
    const record: ImageActions = { image, controls, refresh, fullscreen, events: imageEvents };
    const enter = () => hover(record);
    const leave = (event: PointerEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && (record.image.contains(next) || controls.contains(next))) return;
      if (hovered === record) hover(null);
    };
    image.addEventListener('pointerenter', enter, { signal });
    image.addEventListener('pointerleave', leave, { signal });
    controls.addEventListener('pointerenter', enter, { signal });
    controls.addEventListener('pointerleave', leave, { signal });
    controls.addEventListener('focusin', event => {
      if (!(event.target as HTMLElement).hasAttribute('data-meo-pointer-focus')) options.reveal(record.image);
      position(record);
    }, { signal });
    controls.addEventListener('pointerdown', event => {
      if (event.button === 0) event.preventDefault();
      suppressRenderedBlockPointerFocus(controls);
      const button = (event.target as Element).closest<HTMLElement>('[role="button"]');
      if (button) focusRenderedBlockAction(button, true);
    }, { signal });
    image.addEventListener('load', () => update(record), { signal });
    image.addEventListener('error', () => update(record), { signal });
    const anchor = image.closest('a') ?? image.closest('picture') ?? image;
    anchor.after(controls);
    records.set(image, record); update(record);
  };
  const update = (record: ImageActions) => {
    record.refresh.setAttribute('aria-disabled', String(record.image.dataset.meoPreviewImageRefreshing === 'true'));
    const enabled = ready(record.image);
    record.fullscreen.setAttribute('aria-disabled', String(!enabled));
    record.fullscreen.tabIndex = enabled ? 0 : -1;
  };
  return {
    sync() {
      for (const record of records.values()) if (!record.image.isConnected || !record.controls.isConnected) remove(record);
      for (const image of owner.querySelectorAll<HTMLImageElement>('main.meo-export-doc img')) {
        if (source(image) && !records.has(image)) attach(image);
      }
      for (const record of records.values()) {
        update(record);
        const labels = [strings().refreshImage, externalLabel(record.image), strings().fullscreenImage];
        Array.from(record.controls.querySelectorAll<HTMLElement>('[role="button"]')).forEach((button, index) => {
          button.dataset.tooltip = labels[index]; button.setAttribute('aria-label', labels[index]!);
        });
      }
      schedulePosition();
    },
    replace(previous: HTMLImageElement, next: HTMLImageElement) {
      const record = records.get(previous);
      const focused = record?.controls.contains(owner.activeElement)
        ? Array.from(record.controls.children).indexOf(owner.activeElement!) : -1;
      const pointerDriven = owner.activeElement?.hasAttribute('data-meo-pointer-focus') ?? false;
      if (record) remove(record);
      attach(next);
      if (next.matches(':hover')) hover(records.get(next)!);
      if (focused >= 0) focusRenderedBlockAction(records.get(next)!.controls.children[focused] as HTMLElement, pointerDriven);
    },
    closeFullscreen() { viewer?.close(); hover(null); },
    reportRefreshFailure(image: HTMLImageElement) {
      const record = records.get(image);
      if (record) reportFailure(record);
    },
    dispose() {
      viewer?.close(); events.abort(); resize.disconnect();
      if (frame !== null) owner.defaultView!.cancelAnimationFrame(frame);
      for (const record of records.values()) remove(record);
    }
  };
}

export const previewImageActionStyles = `
.meo-preview-image-actions { position: fixed; top: 0; left: 0; right: auto; padding: 2px; border-radius: 6px; background: var(--meo-bg); }
.meo-preview-image-actions[data-meo-image-hover] { opacity: 1; pointer-events: auto; }
.meo-preview-image-actions[hidden] { display: none; }
`;
