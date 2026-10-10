// Diagram surfaces follow the editor's gray/blue baseline. Only categorical
// charts use official Catppuccin Mocha accents, starting with blue.
// https://github.com/catppuccin/catppuccin#-palette
const chartColors = [
  '#89b4fa', '#94e2d5', '#a6e3a1', '#fab387', '#f9e2af', '#f38ba8',
  '#f5c2e7', '#cba6f7', '#74c7ec', '#b4befe', '#eba0ac', '#f2cdcd'
];

/** Shared diagram colors keep Live, Preview and exported documents consistent. */
export function getMermaidPalette(darkMode: boolean) {
  return darkMode ? {
    nodeBackground: '#2a3036',
    secondaryBackground: '#31363b',
    tertiaryBackground: '#3a4149',
    clusterBackground: '#24292e',
    foreground: '#e6edf3',
    border: '#676f7d',
    line: '#61afef',
    chartColors,
    chartTextColor: '#24292f'
  } : {
    nodeBackground: '#eef1f4',
    secondaryBackground: '#f1f3f5',
    tertiaryBackground: '#e6e8eb',
    clusterBackground: '#f6f8fa',
    foreground: '#24292f',
    border: '#8c959f',
    line: '#0550ae',
    chartColors,
    chartTextColor: '#24292f'
  };
}
