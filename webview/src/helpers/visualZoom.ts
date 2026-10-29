/** Viewing zoom is relative to the fitted content; retain the existing minimum. */
export function stepVisualZoom(
  zoom: number,
  direction: 1 | -1,
  input: 'button' | 'wheel' = 'button'
): number {
  const factor = input === 'button' ? 1.25 : 1.1;
  // A numerical guard, rather than a normal viewing limit.
  return Math.max(0.25, Math.min(1024, zoom * factor ** direction));
}

/** Keep the content point under a client-coordinate anchor fixed while zooming.
 * Viewing surfaces use a centered transform origin; pan is in local CSS pixels. */
export function visualZoomPanAtPoint(
  content: HTMLElement,
  camera: { zoom: number; panX: number; panY: number },
  nextZoom: number,
  point: { x: number; y: number }
): { panX: number; panY: number } {
  const bounds = content.getBoundingClientRect();
  const parent = content.parentElement!;
  const viewport = parent.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { panX: camera.panX, panY: camera.panY };
  }
  const scaleX = viewport.width / (parent.offsetWidth || viewport.width);
  const scaleY = viewport.height / (parent.offsetHeight || viewport.height);
  const ratio = nextZoom / camera.zoom;
  return {
    panX: camera.panX + (point.x - (bounds.left + bounds.width / 2)) / scaleX * (1 - ratio),
    panY: camera.panY + (point.y - (bounds.top + bounds.height / 2)) / scaleY * (1 - ratio)
  };
}
