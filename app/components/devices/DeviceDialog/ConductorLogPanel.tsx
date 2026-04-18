import { useEffect, useRef, useState } from "react";
import { Input } from "@argus/peacock";
import { runConductorCommand } from "../../../lib/ipc";
import {
  useConductorLogs,
  useInitialConductorLogs,
} from "../../../stores/conductorLogStore";
import styles from "./ConductorLogPanel.module.css";

interface ConductorLogPanelProps {
  deviceKey: string;
}

/** Split a command line into argv, honoring single/double quotes and backslash escapes. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) {
    out.push(cur);
  }

  return out;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function ConductorLogPanel({ deviceKey }: ConductorLogPanelProps) {
  useInitialConductorLogs(deviceKey);
  const entries = useConductorLogs(deviceKey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length]);

  const submit = async (): Promise<void> => {
    const trimmed = cmd.trim();
    if (!trimmed || busy) {
      return;
    }
    const args = tokenize(trimmed);
    if (args.length === 0) {
      return;
    }
    setBusy(true);
    try {
      await runConductorCommand(deviceKey, args);
      setCmd("");
    } catch {
      // Error is already surfaced as a log entry by the backend.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.liveDot} />
        Live device log
        <span className={styles.count}>{entries.length} entries</span>
      </div>
      <div ref={scrollRef} className={styles.list}>
        {entries.length === 0 ? (
          <div className={styles.empty}>
            No conductor activity recorded for this device yet.
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className={`${styles.row} ${e.ok ? styles.ok : styles.err}`}
            >
              <span className={styles.ts}>{formatTs(e.ts)}</span>
              <span className={styles.kind}>{e.kind}</span>
              <span className={styles.cmd}>
                {e.command}
                {e.args && e.kind === "cli"
                  ? ` ${e.args.slice(e.command.length).trim()}`
                  : ""}
                {e.args && e.kind === "http" && e.args.length > 0 ? (
                  <span className={styles.detail}>{e.args}</span>
                ) : null}
                {e.error ? (
                  <span className={`${styles.detail} ${styles.errMsg}`}>
                    {e.error}
                  </span>
                ) : null}
                {e.output && !e.ok ? (
                  <span className={styles.detail}>{e.output}</span>
                ) : null}
              </span>
              <span className={styles.dur}>{e.durationMs}ms</span>
            </div>
          ))
        )}
      </div>
      <form
        className={styles.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          submit().catch(() => {});
        }}
      >
        <span className={styles.prompt}>›</span>
        <Input
          mono
          bare
          className={styles.input}
          placeholder="Inject conductor command (e.g. tap 100 200)"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
        />
      </form>
    </div>
  );
}
