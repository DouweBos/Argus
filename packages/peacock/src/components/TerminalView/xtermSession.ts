/**
 * xterm and its fit addon, loaded on first use so a terminal costs nothing
 * until one is on screen.
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { readTerminalTheme, watchTerminalTheme } from "./terminalTheme";

export interface XtermSessionOptions {
  readOnly: boolean;
  fontSize: number;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export interface XtermSession {
  write: (data: Uint8Array | string) => void;
  reset: () => void;
  fit: () => void;
  dispose: () => void;
}

export function openXterm(
  container: HTMLElement,
  { readOnly, fontSize, onInput, onResize }: XtermSessionOptions,
): XtermSession {
  const term = new Terminal({
    theme: readTerminalTheme(container),
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    fontSize,
    lineHeight: 1.3,
    cursorBlink: !readOnly,
    cursorStyle: readOnly ? "bar" : "block",
    cursorInactiveStyle: readOnly ? "none" : "outline",
    disableStdin: readOnly,
    scrollback: 5000,
    convertEol: false,
    allowTransparency: false,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  const fit = () => {
    try {
      fitAddon.fit();
    } catch {
      // Not laid out yet.
    }
  };
  fit();

  const input = onInput ? term.onData(onInput) : null;
  const resized = onResize
    ? term.onResize(({ cols, rows }) => onResize(cols, rows))
    : null;
  const stopTheme = watchTerminalTheme(() => {
    term.options.theme = readTerminalTheme(container);
  });
  const observer = new ResizeObserver(fit);
  observer.observe(container);

  return {
    write: (data) => term.write(data),
    reset: () => term.reset(),
    fit,
    dispose: () => {
      observer.disconnect();
      stopTheme();
      input?.dispose();
      resized?.dispose();
      term.dispose();
    },
  };
}
