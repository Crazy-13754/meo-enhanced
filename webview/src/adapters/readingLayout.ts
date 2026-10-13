import type { WebviewVisibilityRequest, WebviewVisibilityResponse } from '../../../src/protocol/webviewVisibility';
import { createRequestPrefix } from './requestIdentity';

/**
 * Retain reading geometry until the browser or Host confirms a visible viewport.
 * Refresh on viewport/visibility changes, accept validated Host replies, and
 * dispose with the Webview. Unanswered or obsolete replies retain the last layout.
 */
export function createReadingLayoutController(root: HTMLElement, post: (request: WebviewVisibilityRequest) => void) {
  const initial = root.getBoundingClientRect();
  root.style.minWidth = `${initial.width}px`;
  root.style.minHeight = `${initial.height}px`;
  const prefix = createRequestPrefix();
  let sequence = 0;
  let disposed = false;
  let refreshFrame: number | null = null;
  let pending: { requestId: string; width: number; height: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const clearPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };
  const apply = (width: number, height: number) => {
    // A reply for an older viewport must never authorize the current parked size.
    if (disposed || Math.abs(innerWidth - width) > 1 || Math.abs(innerHeight - height) > 1) return;
    root.style.minWidth = `${width}px`;
    root.style.minHeight = `${height}px`;
  };
  const options: IntersectionObserverInit & { trackVisibility: boolean; delay: number } = {
    trackVisibility: true, delay: 100
  };
  const observer = new IntersectionObserver(entries => {
    const entry = entries.at(-1);
    if (disposed || !entry?.isIntersecting || entry.intersectionRect.width <= 0 || entry.intersectionRect.height <= 0) return;
    const { width, height } = entry.boundingClientRect;
    if (width <= 0 || height <= 0 || (root.style.minWidth === `${width}px` && root.style.minHeight === `${height}px`)) return;
    clearPending();
    // Painted visibility has no false positives, but VS Code's clipping ancestors
    // can produce false negatives. Ask the actual panel owner in that case; do not
    // infer visibility from a viewport size, focus, or geometric intersection.
    if ('isVisible' in entry && entry.isVisible === true) {
      apply(width, height);
      return;
    }
    const requestId = `${prefix}-${++sequence}`;
    pending = { requestId, width, height, timer: setTimeout(clearPending, 2000) };
    try { post({ type: 'requestWebviewVisibility', requestId }); }
    catch { clearPending(); }
  }, options);
  const refresh = () => {
    clearPending();
    if (disposed || refreshFrame !== null) return;
    // Coalesce resize events, not delayed observer callbacks: waiting for an old
    // callback can otherwise miss the final size of a continuous window resize.
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      observer.disconnect();
      observer.takeRecords();
      observer.observe(document.documentElement);
    });
  };
  refresh();
  return {
    refresh,
    accept(response: WebviewVisibilityResponse) {
      if (!pending || pending.requestId !== response.requestId) return;
      const { width, height } = pending;
      clearPending();
      if (response.visible) apply(width, height);
    },
    dispose() {
      disposed = true;
      clearPending();
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
      observer.disconnect();
    }
  };
}
