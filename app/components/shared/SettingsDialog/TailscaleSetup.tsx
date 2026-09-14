import type {
  TailscaleDiagnosis,
  TailscaleFixKind,
  TailscaleStep,
  TailscaleStepState,
} from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import { Button, ChecklistRow, type StatusPillTone } from "@argus/peacock";
import { remoteTailscaleDiagnose, remoteTailscaleFix } from "../../../lib/ipc";
import styles from "./TailscaleSetup.module.css";

const STATE_TONE: Record<TailscaleStepState, StatusPillTone> = {
  ok: "pass",
  fail: "fail",
  blocked: "skipped",
};

/** Fixes that finish in the browser, so the row should say so afterwards. */
const BROWSER_FIXES: TailscaleFixKind[] = ["open-url", "sign-in"];

export function TailscaleSetup() {
  const [diagnosis, setDiagnosis] = useState<TailscaleDiagnosis | null>(null);
  const [checking, setChecking] = useState(false);
  const [runningFix, setRunningFix] = useState<TailscaleFixKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setDiagnosis(await remoteTailscaleDiagnose());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const runFix = async (step: TailscaleStep) => {
    if (!step.fix) {
      return;
    }
    setRunningFix(step.fix);
    setError(null);
    setHandedOff(false);
    try {
      const result = await remoteTailscaleFix(step.fix, step.url);
      setDiagnosis(result.diagnosis);
      setError(result.error);
      // The browser now owns the next step; the checks can't advance until the
      // user finishes there, so prompt them to re-check rather than looking stuck.
      if (!result.error && BROWSER_FIXES.includes(step.fix)) {
        setHandedOff(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningFix(null);
    }
  };

  const busy = checking || runningFix !== null;

  return (
    <div className={styles.wrap}>
      {(diagnosis?.steps ?? []).map((step) => (
        <ChecklistRow
          key={step.id}
          title={step.title}
          message={step.message}
          detail={step.detail ?? undefined}
          tone={
            runningFix !== null && step.fix === runningFix
              ? "running"
              : STATE_TONE[step.state]
          }
          action={
            step.fix ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => runFix(step)}
              >
                {runningFix === step.fix ? "Working…" : step.fixLabel}
              </Button>
            ) : undefined
          }
        />
      ))}

      {handedOff && (
        <p className={styles.hint}>Finish in the browser, then re-check.</p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.footer}>
        <Button variant="secondary" disabled={busy} onClick={check}>
          {checking ? "Checking…" : "Re-check"}
        </Button>
        {diagnosis?.ready && (
          <span className={styles.ready}>
            Ready — enable remote access to start the Funnel.
          </span>
        )}
      </div>
    </div>
  );
}
