/**
 * Serialize a raw filesystem path for a Markdown destination. Keep Unicode
 * readable; escape syntax and URI delimiters so filenames retain their identity.
 * The input must be a filesystem path, never an already encoded URL.
 */
export function encodeMarkdownPath(path: string): string {
  const windowsDrive = /^[a-z]:[\\/]/i.test(path);
  return path.replace(/[\s\u0000-\u001f\u007f-\u009f%()[\]<>#?&:\\|"'`]/gu, (character, offset: number) => {
    if (character === ':' && offset === 1 && windowsDrive) return character;
    const code = character.charCodeAt(0);
    return code <= 0x7f ? '%' + code.toString(16).toUpperCase().padStart(2, '0') : encodeURIComponent(character);
  });
}

/** Display only: decode once, retaining URI delimiters and malformed escapes. */
export function formatLinkDestination(destination: string): string {
  // Decode one UTF-8 character at a time so invalid bytes cannot hide adjacent
  // valid Chinese, and an escaped percent sign is never decoded a second time.
  return destination.replace(/%(?:[0-7][0-9a-f]|[cd][0-9a-f]%[89ab][0-9a-f]|e[0-9a-f](?:%[89ab][0-9a-f]){2}|f[0-4](?:%[89ab][0-9a-f]){3})/gi, encoded => {
    try { return decodeURI(encoded); }
    catch { return encoded; }
  });
}
