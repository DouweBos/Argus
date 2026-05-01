/**
 * Phase 7 T3 — bisect step UI (project scope only).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  GitErrorBanner,
  Input,
  type GitErrorKind,
} from "@argus/peacock";
import { GitError } from "../../../../lib/gitError";
import {
  gitBisectBad,
  gitBisectGood,
  gitBisectReset,
  gitBisectSkip,
  gitBisectStart,
  gitBisectStatus,
  type BisectStatus,
  type BisectStep,
} from "../../../../lib/ipc";
import { setGitView } from "../../../../stores/editorStore";
import { requestFocusCommit } from "../../../../stores/gitUiStore";
import styles from "./BisectView.module.css";

interface BannerState {
  kind: GitErrorKind;
  message: string;
}

interface Props {
  sessionId: string;
}

export function BisectView({ sessionId }: Props) {
  const [status, setStatus] = useState<BisectStatus | null>(null);
  const [goodRef, setGoodRef] = useState("");
  const [badRef, setBadRef] = useState("HEAD");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [finished, setFinished] = useState<BisectStep | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await gitBisectStatus(sessionId);
      setStatus(s);
    } catch (err) {
      handleErr(err, setBanner);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runStep = useCallback(
    async (op: () => Promise<BisectStep>) => {
      setBanner(null);
      setBusy(true);
      try {
        const step = await op();
        if (step.finished) {
          setFinished(step);
        }
        await refresh();
      } catch (err) {
        handleErr(err, setBanner);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const start = useCallback(async () => {
    if (!goodRef.trim() || !badRef.trim()) {
      return;
    }
    setBanner(null);
    setBusy(true);
    setFinished(null);
    try {
      const step = await gitBisectStart(sessionId, {
        goodRef: goodRef.trim(),
        badRef: badRef.trim(),
      });
      if (step.finished) {
        setFinished(step);
      }
      await refresh();
    } catch (err) {
      handleErr(err, setBanner);
    } finally {
      setBusy(false);
    }
  }, [sessionId, goodRef, badRef, refresh]);

  const reset = useCallback(async () => {
    setBanner(null);
    setBusy(true);
    try {
      await gitBisectReset(sessionId);
      setFinished(null);
      await refresh();
    } catch (err) {
      handleErr(err, setBanner);
    } finally {
      setBusy(false);
    }
  }, [sessionId, refresh]);

  if (!status) {
    return <div className={styles.container} />;
  }

  if (finished?.firstBadCommit) {
    const bad = finished.firstBadCommit;

    return (
      <div className={styles.container}>
        <div className={styles.finishedCard}>
          <div className={styles.startTitle}>First bad commit found</div>
          <div className={styles.stepHash}>{bad.hash.slice(0, 12)}</div>
          {bad.subject && (
            <div className={styles.stepSubject}>{bad.subject}</div>
          )}
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                setGitView("history");
                requestFocusCommit(bad.hash);
              }}
            >
              View commit
            </Button>
            <Button variant="secondary" disabled={busy} onClick={reset}>
              Reset bisect
            </Button>
          </div>
        </div>
        {banner && (
          <GitErrorBanner
            kind={banner.kind}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        )}
      </div>
    );
  }

  if (!status.active) {
    return (
      <div className={styles.container}>
        <div className={styles.startCard}>
          <div className={styles.startTitle}>Start a bisect</div>
          <div className={styles.startDescription}>
            Provide a known-good ref (older, working) and a known-bad ref
            (newer, broken). Argus will check out commits in between for you to
            test.
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Good ref</span>
            <Input
              value={goodRef}
              placeholder="e.g. v1.2.0"
              onChange={(e) => setGoodRef(e.target.value)}
            />
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Bad ref</span>
            <Input
              value={badRef}
              placeholder="HEAD"
              onChange={(e) => setBadRef(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={busy || !goodRef.trim() || !badRef.trim()}
              onClick={start}
            >
              {busy ? "Starting…" : "Start bisect"}
            </Button>
          </div>
        </div>
        {banner && (
          <GitErrorBanner
            kind={banner.kind}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.stepCard}>
        <div className={styles.startTitle}>Bisecting</div>
        {status.currentRef && (
          <div className={styles.stepHash}>
            {status.currentRef.slice(0, 12)}
          </div>
        )}
        {status.currentSubject && (
          <div className={styles.stepSubject}>{status.currentSubject}</div>
        )}
        {status.remaining != null && (
          <div className={styles.stepRemaining}>
            ~{status.remaining} revisions left to test
          </div>
        )}
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => runStep(() => gitBisectGood(sessionId))}
          >
            Good
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => runStep(() => gitBisectBad(sessionId))}
          >
            Bad
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => runStep(() => gitBisectSkip(sessionId))}
          >
            Skip
          </Button>
          <Button variant="ghost" disabled={busy} onClick={reset}>
            Abort
          </Button>
        </div>
      </div>
      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          onDismiss={() => setBanner(null)}
        />
      )}
    </div>
  );
}

function handleErr(err: unknown, setBanner: (b: BannerState) => void): void {
  if (err instanceof GitError) {
    setBanner({ kind: err.kind, message: err.message });
  } else {
    setBanner({
      kind: "unknown",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
