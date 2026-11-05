/** Headings mirrored into the Explorer outline view. Lines are one-based source lines. */
export type SidebarOutlineHeading = {
  readonly level: number;
  readonly text: string;
  readonly line: number;
};

/** Webview -> host. `headings` is omitted when only the active heading changed. */
export type SidebarOutlineMessage = {
  readonly type: 'sidebarOutline';
  readonly snapshot: string;
  readonly headings?: readonly SidebarOutlineHeading[];
  readonly activeIndex: number;
  readonly visibleIndexes?: readonly number[];
};

/** Host -> webview. The webview publishes headings only while the Explorer view is visible. */
export type SidebarOutlineHostEvent =
  | { readonly type: 'sidebarOutlineSubscription'; readonly enabled: boolean }
  | { readonly type: 'revealOutlineHeading'; readonly key: string; readonly snapshot: string };

export const MAX_SIDEBAR_OUTLINE_HEADINGS = 20_000;
export const MAX_SIDEBAR_OUTLINE_TEXT_LENGTH = 1_000;
const MAX_SIDEBAR_OUTLINE_KEY_LENGTH = 8_192;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isSnapshot = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80;

function isLine(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isHeading(value: unknown): value is SidebarOutlineHeading {
  return isRecord(value)
    && Number.isInteger(value.level) && (value.level as number) >= 1 && (value.level as number) <= 6
    && typeof value.text === 'string' && value.text.length <= MAX_SIDEBAR_OUTLINE_TEXT_LENGTH
    && isLine(value.line);
}

export function decodeSidebarOutlineMessage(value: unknown): SidebarOutlineMessage | null {
  if (!isRecord(value) || value.type !== 'sidebarOutline' || !isSnapshot(value.snapshot)) return null;
  const snapshot = value.snapshot;
  const { headings, activeIndex, visibleIndexes } = value;
  if (!Number.isSafeInteger(activeIndex) || (activeIndex as number) < -1
    || (activeIndex as number) >= MAX_SIDEBAR_OUTLINE_HEADINGS) return null;
  const count = Array.isArray(headings) ? headings.length : MAX_SIDEBAR_OUTLINE_HEADINGS;
  if (visibleIndexes !== undefined && (!Array.isArray(visibleIndexes)
    || visibleIndexes.length > MAX_SIDEBAR_OUTLINE_HEADINGS
    || !visibleIndexes.every((index, position) => Number.isSafeInteger(index) && index >= 0
      && index < count && (position === 0 || visibleIndexes[position - 1] < index)))) return null;
  const viewport = visibleIndexes === undefined ? {} : { visibleIndexes: [...visibleIndexes] as number[] };
  if (headings === undefined) return { type: 'sidebarOutline', snapshot, activeIndex: activeIndex as number, ...viewport };
  if (!Array.isArray(headings) || headings.length > MAX_SIDEBAR_OUTLINE_HEADINGS
    || (activeIndex as number) >= headings.length || !headings.every(isHeading)) return null;
  return {
    type: 'sidebarOutline',
    snapshot,
    headings: headings.map(({ level, text, line }) => ({ level, text, line })),
    activeIndex: activeIndex as number,
    ...viewport
  };
}

export function decodeSidebarOutlineHostEvent(value: unknown): SidebarOutlineHostEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === 'sidebarOutlineSubscription') {
    return typeof value.enabled === 'boolean' ? { type: value.type, enabled: value.enabled } : null;
  }
  if (value.type === 'revealOutlineHeading') {
    return typeof value.key === 'string' && value.key.length > 0 && value.key.length <= MAX_SIDEBAR_OUTLINE_KEY_LENGTH && isSnapshot(value.snapshot)
      ? { type: value.type, key: value.key, snapshot: value.snapshot } : null;
  }
  return null;
}
