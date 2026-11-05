import {
  MAX_SIDEBAR_OUTLINE_HEADINGS,
  MAX_SIDEBAR_OUTLINE_TEXT_LENGTH,
  type SidebarOutlineHeading,
  type SidebarOutlineMessage
} from '../../../src/protocol/sidebarOutline';

/** The same surface the in-editor outline reads: the Live/Source editor or the Preview adapter. */
export interface SidebarOutlineSource {
  getHeadings(): readonly { text: string; level: number; from: number; line: number }[];
  isOutlinePending?(): boolean;
  getViewportAnchorOffset(ratio?: number): number;
  getVisibleDocumentRange(): unknown | null;
  getScrollElement(): EventTarget;
  scrollToLine(line: number, position: string): void;
}

type Timers = {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
};

/** Matches the in-editor outline: the heading above 20% of the viewport is current. */
export const SIDEBAR_OUTLINE_ACTIVE_VIEWPORT_RATIO = 0.2;
const PUBLISH_DELAY_MS = 120;
const PENDING_RETRY_MS = 50;

export function findActiveHeadingIndex(headingStarts: readonly number[], anchor: number): number {
  let active = -1;
  for (let index = 0; index < headingStarts.length; index += 1) {
    if (headingStarts[index] <= anchor) active = index;
    else break;
  }
  return active;
}

const browserTimers: Timers = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: handle => window.clearTimeout(handle as number),
  requestFrame: callback => window.requestAnimationFrame(callback),
  cancelFrame: handle => window.cancelAnimationFrame(handle as number)
};

/**
 * Publishes headings for the Explorer outline view. Work runs only while the host
 * reports that view as visible, so hidden sidebars cost nothing per keystroke or scroll.
 */
export function createSidebarOutlineReporter(
  getSource: () => SidebarOutlineSource | null,
  post: (message: SidebarOutlineMessage) => void,
  timers: Timers = browserTimers
) {
  let enabled = false;
  let disposed = false;
  let timer: unknown = null;
  let frame: unknown = null;
  let boundScrollElement: EventTarget | null = null;
  let sentKey: string | null = null;
  let sentActive = -2;
  let headingStarts: number[] = [];

  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const cancelFrame = () => {
    if (frame !== null) timers.cancelFrame(frame);
    frame = null;
  };
  const unbindScroll = () => {
    boundScrollElement?.removeEventListener('scroll', scheduleActive);
    boundScrollElement = null;
  };
  const bindScroll = (source: SidebarOutlineSource) => {
    const element = source.getScrollElement();
    if (element === boundScrollElement) return;
    unbindScroll();
    boundScrollElement = element;
    element.addEventListener('scroll', scheduleActive, { passive: true } as AddEventListenerOptions);
  };

  const readActive = (source: SidebarOutlineSource): number => {
    if (headingStarts.length === 0 || !source.getVisibleDocumentRange()) return -1;
    return findActiveHeadingIndex(headingStarts, source.getViewportAnchorOffset(SIDEBAR_OUTLINE_ACTIVE_VIEWPORT_RATIO));
  };

  const publish = () => {
    timer = null;
    if (!enabled || disposed) return;
    const source = getSource();
    if (!source) return;
    if (source.isOutlinePending?.()) {
      timer = timers.setTimeout(publish, PENDING_RETRY_MS);
      return;
    }
    bindScroll(source);
    const all = source.getHeadings();
    const limited = all.length > MAX_SIDEBAR_OUTLINE_HEADINGS ? all.slice(0, MAX_SIDEBAR_OUTLINE_HEADINGS) : all;
    headingStarts = limited.map(heading => heading.from);
    const headings: SidebarOutlineHeading[] = limited.map(heading => ({
      level: Math.min(6, Math.max(1, Math.trunc(heading.level))),
      text: heading.text.trim().slice(0, MAX_SIDEBAR_OUTLINE_TEXT_LENGTH),
      line: Math.max(1, Math.trunc(heading.line))
    }));
    const key = JSON.stringify(headings);
    const activeIndex = readActive(source);
    if (key !== sentKey) {
      sentKey = key;
      sentActive = activeIndex;
      post({ type: 'sidebarOutline', headings, activeIndex });
    } else if (activeIndex !== sentActive) {
      sentActive = activeIndex;
      post({ type: 'sidebarOutline', activeIndex });
    }
  };

  const refreshActive = () => {
    frame = null;
    if (!enabled || disposed || sentKey === null) return;
    const source = getSource();
    if (!source) return;
    const activeIndex = readActive(source);
    if (activeIndex === sentActive) return;
    sentActive = activeIndex;
    post({ type: 'sidebarOutline', activeIndex });
  };

  function scheduleActive() {
    if (!enabled || disposed || frame !== null) return;
    frame = timers.requestFrame(refreshActive);
  }

  const schedule = () => {
    if (!enabled || disposed) return;
    cancelTimer();
    timer = timers.setTimeout(publish, PUBLISH_DELAY_MS);
  };

  return {
    /** Headings or the editing surface may have changed (edit, mode switch, Preview render). */
    schedule,
    /** Viewport moved without a scroll event (layout or Preview geometry change). */
    refreshViewport: scheduleActive,
    setEnabled(next: boolean) {
      if (disposed || next === enabled) return;
      enabled = next;
      cancelTimer();
      cancelFrame();
      if (!enabled) {
        unbindScroll();
        return;
      }
      // The host forgets a panel's headings while hidden; always resend on enable.
      sentKey = null;
      sentActive = -2;
      timer = timers.setTimeout(publish, 0);
    },
    reveal(line: number) {
      getSource()?.scrollToLine(line, 'top');
    },
    isEnabled: () => enabled,
    dispose() {
      disposed = true;
      enabled = false;
      cancelTimer();
      cancelFrame();
      unbindScroll();
    }
  };
}
