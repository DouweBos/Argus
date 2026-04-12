import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { startTerminal, terminalResize, terminalWrite } from "../lib/ipc";
import {
  attachWriter,
  detachWriter,
  drainPending,
} from "../lib/terminalBufferService";
import { cacheBuffer, getBuffer } from "../stores/terminalStore";
import "@xterm/xterm/css/xterm.css";

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

interface UseTerminalOptions {
  onExit?: (code: number) => void;
  sessionId: string | null;
}

interface SearchState {
  resultCount: number;
  resultIndex: number;
}

interface UseTerminalResult {
  fit: () => void;
  hideSearch: () => void;
  searchNext: (query: string) => void;
  searchPrevious: (query: string) => void;
  searchState: SearchState;
  searchVisible: boolean;
  showSearch: () => void;
  terminal: Terminal | null;
  terminalRef: React.RefObject<HTMLDivElement | null>;
}

export function useTerminal({
  sessionId,
  onExit,
}: UseTerminalOptions): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE);
  const onExitRef = useRef(onExit);
  const listenersRef = useRef(new Set<() => void>());
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>({
    resultIndex: -1,
    resultCount: 0,
  });

  useEffect(() => {
    onExitRef.current = onExit;
  });

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);

    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  const getSnapshot = useCallback(() => terminalInstanceRef.current, []);

  const terminal = useSyncExternalStore(subscribe, getSnapshot);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const showSearch = useCallback(() => setSearchVisible(true), []);
  const hideSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchState({ resultIndex: -1, resultCount: 0 });
    searchAddonRef.current?.clearDecorations();
    terminalInstanceRef.current?.focus();
  }, []);
  const countMatches = useCallback((query: string): number => {
    const term = terminalInstanceRef.current;
    if (!term || !query) {
      return 0;
    }
    const buf = term.buffer.active;
    let count = 0;
    const lowerQuery = query.toLowerCase();
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)?.translateToString() ?? "";
      let idx = 0;
      while ((idx = line.toLowerCase().indexOf(lowerQuery, idx)) !== -1) {
        count++;
        idx += lowerQuery.length;
      }
    }

    return count;
  }, []);

  const lastQueryRef = useRef("");

  const searchNext = useCallback(
    (query: string) => {
      const found = searchAddonRef.current?.findNext(query) ?? false;
      const total = countMatches(query);
      if (!found || total === 0) {
        setSearchState({ resultIndex: -1, resultCount: total });
        lastQueryRef.current = query;

        return;
      }

      const isNewQuery = query !== lastQueryRef.current;
      lastQueryRef.current = query;
      setSearchState((prev) => {
        if (isNewQuery) {
          return { resultIndex: 0, resultCount: total };
        }
        const next = prev.resultIndex + 1;

        return { resultIndex: next >= total ? 0 : next, resultCount: total };
      });
    },
    [countMatches],
  );

  const searchPrevious = useCallback(
    (query: string) => {
      const found = searchAddonRef.current?.findPrevious(query) ?? false;
      const total = countMatches(query);
      if (!found || total === 0) {
        setSearchState({ resultIndex: -1, resultCount: total });
        lastQueryRef.current = query;

        return;
      }

      const isNewQuery = query !== lastQueryRef.current;
      lastQueryRef.current = query;
      setSearchState((prev) => {
        if (isNewQuery) {
          return { resultIndex: total - 1, resultCount: total };
        }
        const next = prev.resultIndex - 1;

        return { resultIndex: next < 0 ? total - 1 : next, resultCount: total };
      });
    },
    [countMatches],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) {
      return;
    }

    const term = new Terminal({
      theme: {
        background: "#202020",
        foreground: "#e8e8e8",
        cursor: "#509050",
        cursorAccent: "#202020",
        selectionBackground: "#383838",
        black: "#303030",
        red: "#a05050",
        green: "#509050",
        yellow: "#b8a050",
        blue: "#5a8ab0",
        magenta: "#a06090",
        cyan: "#509090",
        white: "#b0b0b0",
        brightBlack: "#505050",
        brightRed: "#a05050",
        brightGreen: "#509050",
        brightYellow: "#b8a050",
        brightBlue: "#5a8ab0",
        brightMagenta: "#a06090",
        brightCyan: "#509090",
        brightWhite: "#e8e8e8",
      },
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowTransparency: false,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const serializeAddon = new SerializeAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(serializeAddon);
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    term.open(container);
    fitAddon.fit();

    // Start the shell at the correct dimensions.  create_terminal only
    // opens the PTY — start_terminal resizes it and spawns the shell, so
    // the shell's line editor initializes with the real geometry.
    const { cols, rows } = term;
    startTerminal(sessionId, cols, rows).catch(() => {});

    // Restore cached buffer (non-destructive read — survives StrictMode)
    const cached = getBuffer(sessionId);
    if (cached) {
      term.write(cached);
    }

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;
    listenersRef.current.forEach((cb) => cb());

    // Defer pending-data flush + writer attachment to the next animation frame.
    // StrictMode runs setup→cleanup→setup synchronously — the rAF from the
    // intermediate setup never fires, so pending data stays in the buffer
    // service instead of being written to a terminal that's about to be disposed.
    let settled = false;
    const flushId = requestAnimationFrame(() => {
      settled = true;
      const pending = drainPending(sessionId);
      for (const chunk of pending) {
        term.write(chunk);
      }

      attachWriter(sessionId, (data) => term.write(data));
    });

    // macOS keyboard shortcuts
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.metaKey) {
        return true;
      }

      switch (e.key) {
        // Cmd+K — clear terminal
        case "k":
          term.clear();

          return false;

        // Cmd+C — copy selection (fall through to PTY if no selection)
        case "c":
          if (term.hasSelection()) {
            navigator.clipboard.writeText(term.getSelection());

            return false;
          }

          return true;

        // Cmd+V — paste from clipboard
        case "v":
          navigator.clipboard.readText().then((text) => {
            if (text && sessionId) {
              terminalWrite(sessionId, btoa(text)).catch(() => {});
            }
          });

          return false;

        // Cmd+A — select all
        case "a":
          term.selectAll();

          return false;

        // Cmd+F — find in terminal
        case "f":
          setSearchVisible(true);

          return false;

        // Cmd+Plus / Cmd+= — zoom in
        case "=":
        case "+":
          if (fontSizeRef.current < MAX_FONT_SIZE) {
            fontSizeRef.current = Math.min(
              fontSizeRef.current + 1,
              MAX_FONT_SIZE,
            );
            term.options.fontSize = fontSizeRef.current;
            fitAddon.fit();
          }

          return false;

        // Cmd+Minus — zoom out
        case "-":
          if (fontSizeRef.current > MIN_FONT_SIZE) {
            fontSizeRef.current = Math.max(
              fontSizeRef.current - 1,
              MIN_FONT_SIZE,
            );
            term.options.fontSize = fontSizeRef.current;
            fitAddon.fit();
          }

          return false;

        // Cmd+0 — reset zoom
        case "0":
          fontSizeRef.current = DEFAULT_FONT_SIZE;
          term.options.fontSize = DEFAULT_FONT_SIZE;
          fitAddon.fit();

          return false;

        default:
          return true;
      }
    });

    // Send user input to backend
    const dataDispose = term.onData((data) => {
      terminalWrite(sessionId, btoa(data)).catch(() => {});
    });

    // ResizeObserver to keep terminal dimensions in sync
    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current || !terminalInstanceRef.current) {
        return;
      }
      try {
        fitAddonRef.current.fit();
        const { cols: termCols, rows: termRows } = terminalInstanceRef.current;
        terminalResize(sessionId, termCols, termRows).catch(() => {});
      } catch {
        // ignore fit errors during layout transitions
      }
    });
    resizeObserver.observe(container);

    const sid = sessionId;
    const listeners = listenersRef.current;

    return () => {
      cancelAnimationFrame(flushId);

      // Only serialize if the rAF fired (real mount, not StrictMode intermediate).
      // StrictMode's intermediate cleanup would serialize an empty buffer
      // (async writes haven't processed) and overwrite the good cache.
      if (settled) {
        try {
          const serialized = serializeAddon.serialize();
          if (serialized) {
            cacheBuffer(sid, serialized);
          }
        } catch {
          // serialization can fail if terminal is already disposed
        }
      }

      detachWriter(sid);
      dataDispose.dispose();
      resizeObserver.disconnect();
      term.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      listeners.forEach((cb) => cb());
    };
  }, [sessionId]);

  return {
    terminalRef: containerRef,
    terminal,
    fit,
    searchVisible,
    searchState,
    showSearch,
    hideSearch,
    searchNext,
    searchPrevious,
  };
}
