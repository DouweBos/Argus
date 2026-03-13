import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  getLogEntries,
  clearLogEntries,
  subscribe,
} from "../../lib/logService";
import type { LogEntry } from "../../lib/logService";
import { CloseIcon } from "../shared/Icons";
import styles from "./LogsPanel.module.css";
import dialogStyles from "../sidebar/Dialog.module.css";

type LevelFilter = "all" | "DEBUG" | "ERROR" | "INFO" | "WARN";

const LEVEL_CLASSES: Record<string, string> = {
  ERROR: styles.levelError,
  WARN: styles.levelWarn,
  INFO: styles.levelInfo,
  DEBUG: styles.levelDebug,
};

interface LogsModalProps {
  onClose: () => void;
}

export function LogsModal({ onClose }: LogsModalProps) {
  const entries = useSyncExternalStore(subscribe, getLogEntries);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const visible =
    filter === "all" ? entries : entries.filter((e) => e.level === filter);

  // Auto-scroll to bottom when new entries arrive.
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visible]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className={dialogStyles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={dialogStyles.header}>
          <span className={dialogStyles.title}>Backend Logs</span>
          <button className={dialogStyles.closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.toolbar}>
          {(["all", "ERROR", "WARN", "INFO", "DEBUG"] as LevelFilter[]).map(
            (level) => (
              <button
                key={level}
                className={`${styles.filterBtn} ${filter === level ? styles.filterBtnActive : ""}`}
                onClick={() => setFilter(level)}
              >
                {level === "all" ? "All" : level}
              </button>
            ),
          )}
          <button className={styles.clearBtn} onClick={clearLogEntries}>
            Clear
          </button>
        </div>

        {visible.length === 0 ? (
          <div className={styles.empty}>No log entries yet.</div>
        ) : (
          <div className={styles.list} ref={listRef} onScroll={handleScroll}>
            {visible.map((entry: LogEntry, i: number) => (
              <div key={i} className={styles.entry}>
                <span className={styles.timestamp}>
                  {formatTime(entry.timestamp_ms)}
                </span>
                <span
                  className={`${styles.level} ${LEVEL_CLASSES[entry.level] ?? ""}`}
                >
                  {entry.level}
                </span>
                <span className={styles.target}>{entry.target}</span>
                <span className={styles.message}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const msRem = ms % 1000;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(msRem).padStart(3, "0")}`;
}
