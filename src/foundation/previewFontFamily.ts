export const MAX_PREVIEW_FONT_FAMILY_LENGTH = 128;

export function normalizePreviewFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length > MAX_PREVIEW_FONT_FAMILY_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    || /[<>,"\\;{}]/u.test(normalized)) return null;
  return normalized;
}
