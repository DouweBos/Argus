import type { StreamDebugTool } from "./types";
import type { LogLevel, LogSource } from "@argus/peacock";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icons, Input, LogEntry } from "@argus/peacock";
import { debugStartStream, debugStopStream } from "../../../../lib/ipc";
import styles from "./DebugTool.module.css";

interface StreamViewProps {
  deviceKey: string;
  tool: StreamDebugTool;
}

interface ParsedLog {
  id: number;
  kind: "structured";
  level: LogLevel;
  message: string;
  /** Original raw line — used for filter matches and copy. */
  raw: string;
  source: LogSource | null;
  stackTrace: string | null;
  timestamp: string;
}

interface RawLine {
  id: number;
  kind: "raw";
  raw: string;
  /** stderr or non-JSON stdout line — render as plain text. */
  source: "stderr" | "stdout";
  text: string;
}

type Entry = ParsedLog | RawLine;

const MAX_LINES = 2000;

const LEVEL_ALIAS: Record<string, LogLevel> = {
  verbose: "verbose",
  debug: "debug",
  log: "log",
  info: "info",
  warn: "warning",
  warning: "warning",
  error: "error",
};

function tryParseJson(text: string): ParsedLog | null {
  if (!text.startsWith("{")) {
    return null;
  }
  try {
    const obj = JSON.parse(text) as {
      level?: string;
      message?: string;
      source?: string;
      stackTrace?: string | null;
      status?: string;
      timestamp?: string;
    };
    if (obj.status === "error") {
      return null;
    }
    if (typeof obj.message !== "string" || typeof obj.timestamp !== "string") {
      return null;
    }
    const level = LEVEL_ALIAS[obj.level ?? "log"] ?? "log";
    const source =
      obj.source === "metro" ||
      obj.source === "device" ||
      obj.source === "console"
        ? obj.source
        : null;

    return {
      id: 0,
      kind: "structured",
      level,
      message: obj.message,
      stackTrace: obj.stackTrace ?? null,
      source,
      timestamp: obj.timestamp,
      raw: text,
    };
  } catch {
    return null;
  }
}

function entryHaystack(e: Entry): string {
  if (e.kind === "structured") {
    return `${e.message} ${e.stackTrace ?? ""}`.toLowerCase();
  }

  return e.text.toLowerCase();
}

function entryIsError(e: Entry): boolean {
  if (e.kind === "structured") {
    return e.level === "error" || e.level === "warning";
  }

  return e.source === "stderr";
}

/** Streams conductor stdout for a stream-kind debug tool. */
export function StreamView({ deviceKey, tool }: StreamViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [filter, setFilter] = useState("");

  // Snapshot of `entries` taken when paused so the rendered list does not
  // grow until the user resumes. New entries continue to accumulate.
  const [pausedSnapshot, setPausedSnapshot] = useState<Entry[] | null>(null);
  useEffect(() => {
    if (paused) {
      if (!pausedSnapshot) {
        setPausedSnapshot(entries);
      }
    } else if (pausedSnapshot) {
      setPausedSnapshot(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const sourceEntries = pausedSnapshot ?? entries;
  const bufferedWhilePaused = paused
    ? Math.max(0, entries.length - sourceEntries.length)
    : 0;

  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle && !errorsOnly) {
      return sourceEntries;
    }

    return sourceEntries.filter((e) => {
      if (errorsOnly && !entryIsError(e)) {
        return false;
      }
      if (needle && !entryHaystack(e).includes(needle)) {
        return false;
      }

      return true;
    });
  }, [sourceEntries, filter, errorsOnly]);

  const streamId = `${tool.id}:${deviceKey}`;

  useEffect(() => {
    if (!autoScroll || paused) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [visibleEntries, autoScroll, paused]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (!atBottom && autoScroll) {
      setAutoScroll(false);
    } else if (atBottom && !autoScroll) {
      setAutoScroll(true);
    }
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    setAutoScroll(true);
  };

  const start = async () => {
    if (!deviceKey || running) {
      return;
    }
    setError(null);
    setEntries([]);
    setPausedSnapshot(null);

    const unsubData = window.argus.on<{
      source: "stderr" | "stdout";
      text: string;
    }>(`debug:data:${streamId}`, (payload) => {
      const parts = payload.text.split(/\r?\n/);
      setEntries((prev) => {
        const next = [...prev];
        for (const p of parts) {
          if (!p) {
            continue;
          }
          const id = nextIdRef.current++;
          if (payload.source === "stdout") {
            const parsed = tryParseJson(p);
            if (parsed) {
              next.push({ ...parsed, id });
              continue;
            }
          }
          next.push({
            id,
            kind: "raw",
            source: payload.source,
            text: p,
            raw: p,
          });
        }
        if (next.length > MAX_LINES) {
          next.splice(0, next.length - MAX_LINES);
        }

        return next;
      });
    });
    const unsubExit = window.argus.on<{
      code: number | null;
      error?: string;
      signal: string | null;
    }>(`debug:exit:${streamId}`, (payload) => {
      setRunning(false);
      if (payload.error) {
        setError(`conductor failed to start: ${payload.error}`);
      }
      unsubData();
      unsubExit();
    });

    setRunning(true);
    try {
      await debugStartStream(streamId, deviceKey, tool.buildArgs());
    } catch (e) {
      setRunning(false);
      unsubData();
      unsubExit();
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = async () => {
    try {
      await debugStopStream(streamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clear = () => {
    setEntries([]);
    setPausedSnapshot(null);
  };

  const copy = async () => {
    const text = visibleEntries.map((e) => e.raw).join("\n");
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable; fail silently.
    }
  };

  useEffect(() => {
    return () => {
      debugStopStream(streamId).catch(() => {});
    };
  }, [streamId]);

  // Auto-start once a device is available. Parent re-keys this component
  // on device change so this fires on first mount only.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current || !deviceKey) {
      return;
    }
    autoStartedRef.current = true;
    start().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey]);

  return (
    <div className={styles.streamWrap}>
      <div className={styles.controls}>
        {running ? (
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDestructive}`}
            title="Stop streaming"
            onClick={stop}
          >
            <Icons.StopIcon size={12} />
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
            title={deviceKey ? "Start streaming" : "Pick a device first"}
            disabled={!deviceKey}
            onClick={start}
          >
            <Icons.PlayIcon size={12} />
          </button>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          title="Clear log"
          disabled={entries.length === 0}
          onClick={clear}
        >
          <Icons.TrashIcon size={12} />
        </button>
        <div className={styles.divider} />
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={`${styles.tbtn} ${paused ? styles.tbtnActive : ""}`}
            title={paused ? "Resume output" : "Pause output"}
            aria-pressed={paused}
            disabled={!running && !paused}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? (
              <Icons.PlayIcon size={12} />
            ) : (
              <Icons.PauseIcon size={12} />
            )}
          </button>
          <button
            type="button"
            className={`${styles.tbtn} ${autoScroll ? styles.tbtnActive : ""}`}
            title={
              autoScroll
                ? "Auto-scroll: on (scroll up to disable)"
                : "Scroll to bottom & re-enable auto-scroll"
            }
            aria-pressed={autoScroll}
            onClick={scrollToBottom}
          >
            <Icons.ScrollToBottomIcon size={12} />
          </button>
          <button
            type="button"
            className={`${styles.tbtn} ${errorsOnly ? styles.tbtnActive : ""}`}
            title="Show only warnings and errors"
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((v) => !v)}
          >
            <Icons.FilterIcon size={12} />
            <span className={styles.tbtnLabel}>Errors</span>
          </button>
          <button
            type="button"
            className={styles.tbtn}
            title="Copy visible lines"
            disabled={visibleEntries.length === 0}
            onClick={() => {
              copy().catch(() => {});
            }}
          >
            <Icons.CopyIcon size={12} />
          </button>
          <Input
            mono
            bare
            className={styles.filterInput}
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.logViewport}>
        <div ref={scrollRef} className={styles.logScroll} onScroll={onScroll}>
          {visibleEntries.length === 0 && sourceEntries.length > 0 && (
            <div className={styles.empty}>
              <p>No lines match the current filter.</p>
            </div>
          )}
          {visibleEntries.length > 0 && (
            <div className={styles.logList}>
              {visibleEntries.map((e) =>
                e.kind === "structured" ? (
                  <LogEntry
                    key={e.id}
                    timestamp={e.timestamp}
                    level={e.level}
                    message={e.message}
                    stackTrace={e.stackTrace}
                    source={e.source}
                  />
                ) : (
                  <div
                    key={e.id}
                    className={`${styles.rawLine} ${
                      e.source === "stderr" ? styles.rawLineErr : ""
                    }`}
                  >
                    {e.text}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
        {bufferedWhilePaused > 0 && (
          <div className={styles.bufferedOverlay}>
            <button
              type="button"
              className={styles.bufferedPill}
              onClick={() => setPaused(false)}
            >
              +{bufferedWhilePaused} new line
              {bufferedWhilePaused === 1 ? "" : "s"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
