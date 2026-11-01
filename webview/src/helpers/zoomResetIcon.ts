import type { IconNode } from 'lucide';

// Lucide RotateCcw scaled from a radius of 9 to 8 around ZoomIn/ZoomOut's
// (11, 11) lens center, with the same handle and unscaled stroke weight.
export const ZoomReset: IconNode = [
  ['path', { d: 'M3 11a8 8 0 1 0 8-8 8.67 8.67 0 0 0-5.99 2.44L3 7.44' }],
  ['path', { d: 'M3 3v4.44h4.44' }],
  ['line', { x1: '21', x2: '16.65', y1: '21', y2: '16.65' }]
];
