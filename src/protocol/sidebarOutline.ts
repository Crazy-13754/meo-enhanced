/** Headings mirrored into the Explorer outline view. Lines are one-based source lines. */
export type SidebarOutlineHeading = {
  readonly level: number;
  readonly text: string;
  readonly line: number;
};

/** Webview -> host. `headings` is omitted when only the active heading changed. */
export type SidebarOutlineMessage = {
  readonly type: 'sidebarOutline';
  readonly headings?: readonly SidebarOutlineHeading[];
  readonly activeIndex: number;
};

/** Host -> webview. The webview publishes headings only while the Explorer view is visible. */
export type SidebarOutlineHostEvent =
  | { readonly type: 'sidebarOutlineSubscription'; readonly enabled: boolean }
  | { readonly type: 'revealOutlineHeading'; readonly line: number };

export const MAX_SIDEBAR_OUTLINE_HEADINGS = 20_000;
export const MAX_SIDEBAR_OUTLINE_TEXT_LENGTH = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
  if (!isRecord(value) || value.type !== 'sidebarOutline') return null;
  const { headings, activeIndex } = value;
  if (!Number.isSafeInteger(activeIndex) || (activeIndex as number) < -1) return null;
  if (headings === undefined) return { type: 'sidebarOutline', activeIndex: activeIndex as number };
  if (!Array.isArray(headings) || headings.length > MAX_SIDEBAR_OUTLINE_HEADINGS
    || (activeIndex as number) >= headings.length || !headings.every(isHeading)) return null;
  return {
    type: 'sidebarOutline',
    headings: headings.map(({ level, text, line }) => ({ level, text, line })),
    activeIndex: activeIndex as number
  };
}

export function decodeSidebarOutlineHostEvent(value: unknown): SidebarOutlineHostEvent | null {
  if (!isRecord(value)) return null;
  if (value.type === 'sidebarOutlineSubscription') {
    return typeof value.enabled === 'boolean' ? { type: value.type, enabled: value.enabled } : null;
  }
  if (value.type === 'revealOutlineHeading') {
    return isLine(value.line) ? { type: value.type, line: value.line } : null;
  }
  return null;
}
