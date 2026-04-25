import type { OneshotDebugTool } from "./types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@argus/peacock";
import { type DebugCommandResult, debugRunCommand } from "../../../../lib/ipc";
import styles from "./DebugTool.module.css";

interface OneshotViewProps {
  deviceKey: string;
  tool: OneshotDebugTool;
}

function renderResult(result: DebugCommandResult | null) {
  if (result === null) {
    return (
      <div className={styles.empty}>
        <p>Running…</p>
      </div>
    );
  }
  if (result.ok) {
    return (
      <pre className={styles.logPre}>
        {result.stdout.trim().length === 0 ? "(no output)" : result.stdout}
      </pre>
    );
  }

  return (
    <div className={styles.error}>
      <p className={styles.errorTitle}>Command failed</p>
      {result.error && <pre className={styles.logPre}>{result.error}</pre>}
      {result.stderr && <pre className={styles.logPre}>{result.stderr}</pre>}
      {result.stdout && <pre className={styles.logPre}>{result.stdout}</pre>}
    </div>
  );
}

/**
 * Runs a one-shot conductor command. If "Repeat" is toggled, re-runs on
 * the configured interval until toggled off or the component unmounts.
 */
export function OneshotView({ deviceKey, tool }: OneshotViewProps) {
  const [result, setResult] = useState<DebugCommandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [intervalMs, setIntervalMs] = useState(tool.defaultIntervalMs);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  const run = useCallback(async () => {
    if (!deviceKey || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const r = await debugRunCommand(deviceKey, tool.buildArgs());
      setResult(r);
      setLastRunAt(Date.now());
    } catch (e) {
      setResult({
        ok: false,
        stdout: "",
        error: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [deviceKey, tool]);

  // Run-once on mount so the panel has content immediately.
  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    if (!repeating) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      return;
    }
    timerRef.current = setInterval(() => {
      run();
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [repeating, intervalMs, run]);

  const toggleRepeat = () => setRepeating((v) => !v);

  return (
    <div className={styles.oneshotWrap}>
      <div className={styles.controls}>
        <Button
          disabled={!deviceKey || loading}
          size="sm"
          variant="primary"
          onClick={run}
        >
          {loading ? "Running…" : "Run"}
        </Button>
        <Button
          disabled={!deviceKey}
          size="sm"
          variant={repeating ? "secondary" : "ghost"}
          onClick={toggleRepeat}
        >
          {repeating ? "Stop repeating" : "Repeat"}
        </Button>
        <label className={styles.intervalRow}>
          <span>every</span>
          <input
            className={styles.intervalInput}
            max={60000}
            min={250}
            step={250}
            type="number"
            value={intervalMs}
            onChange={(e) =>
              setIntervalMs(Math.max(250, Number(e.target.value) || 1000))
            }
          />
          <span>ms</span>
        </label>
        {lastRunAt !== null && (
          <span className={styles.status}>
            last: {new Date(lastRunAt).toLocaleTimeString()}
            {result && ` · ${result.durationMs}ms`}
          </span>
        )}
      </div>

      <div className={styles.logScroll}>{renderResult(result)}</div>
    </div>
  );
}
