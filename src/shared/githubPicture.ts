/** GitHub selects themed pictures from its chosen theme, independent of the OS. */
export function githubPictureMedia(media: string, appearance: 'light' | 'dark'): string {
  const theme = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i.exec(media.trim());
  return theme ? theme[1].toLowerCase() === appearance ? 'all' : 'not all' : media;
}
