let reloadSequence = 0;

/** Reload a resolved resource without changing its authored destination. */
export function cacheBustedImageSource(source: string): string {
  if (/^(?:data:|blob:)/i.test(source)) return source;
  const hashAt = source.indexOf('#');
  const base = hashAt >= 0 ? source.slice(0, hashAt) : source;
  const hash = hashAt >= 0 ? source.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}meoReload=${++reloadSequence}${hash}`;
}
