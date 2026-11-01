/**
 * xterm paints on a canvas, so it can't read CSS variables itself: this
 * resolves the `--terminal-*` tokens into the theme object it wants. Re-read
 * on a scheme change.
 */

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function readTerminalTheme(
  element: Element = document.documentElement,
): TerminalTheme {
  const style = getComputedStyle(element);
  const token = (name: string) =>
    style.getPropertyValue(`--terminal-${name}`).trim();
  const theme: Record<string, string> = {
    background: token("bg"),
    foreground: token("fg"),
    cursor: token("cursor"),
    cursorAccent: token("bg"),
    selectionBackground: token("selection"),
  };
  for (const color of ANSI) {
    theme[color] = token(color);
    theme[`bright${capitalize(color)}`] = token(`bright-${color}`);
  }

  return theme as unknown as TerminalTheme;
}

/** Calls `onChange` whenever the page switches scheme or colour theme. */
export function watchTerminalTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-theme"],
  });

  return () => observer.disconnect();
}
