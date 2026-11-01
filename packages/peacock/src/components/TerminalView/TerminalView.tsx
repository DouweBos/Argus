import type { XtermSession } from "./xtermSession";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../Spinner/Spinner";
import styles from "./TerminalView.module.css";

export type TerminalChunk =
  | { code: number; kind: "exit" }
  | { data: Uint8Array | string; kind: "data" }
  /** Clear the screen: what follows replays it from the start. */
  | { kind: "reset" };

/**
 * A terminal's output as a stream. `subscribe` first delivers what the
 * terminal holds so far (from a `reset`), then each later chunk once.
 */
export interface TerminalStream {
  subscribe: (sink: (chunks: TerminalChunk[]) => void) => () => void;
}

export interface TerminalViewProps {
  stream: TerminalStream;
  /** Output only: no cursor, keystrokes go nowhere. */
  readOnly?: boolean;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  fontSize?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * An xterm-backed terminal fed from a stream. xterm loads on first mount,
 * so it stays out of bundles that never show a terminal.
 */
export function TerminalView({
  stream,
  readOnly = false,
  onInput,
  onResize,
  fontSize = 12,
  className,
  "aria-label": ariaLabel = "Terminal output",
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onInput, onResize });
  const [session, setSession] = useState<XtermSession | null>(null);

  useEffect(() => {
    callbacks.current = { onInput, onResize };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let disposed = false;
    let opened: XtermSession | null = null;
    import("./xtermSession")
      .then(({ openXterm }) => {
        if (disposed) {
          return;
        }
        opened = openXterm(container, {
          readOnly,
          fontSize,
          onInput: (data) => callbacks.current.onInput?.(data),
          onResize: (cols, rows) => callbacks.current.onResize?.(cols, rows),
        });
        setSession(opened);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      opened?.dispose();
      setSession(null);
    };
  }, [readOnly, fontSize]);

  useEffect(() => {
    if (!session) {
      return;
    }

    return stream.subscribe((chunks) => {
      for (const chunk of chunks) {
        if (chunk.kind === "reset") {
          session.reset();
        } else if (chunk.kind === "data") {
          session.write(chunk.data);
        } else {
          session.write(
            `\r\n\x1b[2m[exited with code ${chunk.code}]\x1b[0m\r\n`,
          );
        }
      }
    });
  }, [session, stream]);

  return (
    <div
      aria-label={ariaLabel}
      className={[styles.terminal, className ?? ""].filter(Boolean).join(" ")}
      role="log"
    >
      <div ref={containerRef} className={styles.surface} />
      {!session && (
        <div className={styles.loading}>
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}
