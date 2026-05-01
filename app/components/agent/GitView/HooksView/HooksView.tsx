/**
 * Phase 7 T8 — manual hook runner.
 *
 * Lists `.git/hooks/*` (executable, non-`.sample`) and lets the user run any
 * one of them manually. The last stdout/stderr/exit-code is persisted under
 * `.git/argus-hooks-log/` so the panel keeps showing the most recent output
 * across navigations.
 */

import { useCallback, useEffect, useState } from "react";
import { GitErrorBanner, GitSkeleton, type GitErrorKind } from "@argus/peacock";
import { GitError } from "../../../../lib/gitError";
import { gitListHooks, gitRunHook, type Hook } from "../../../../lib/ipc";
import styles from "./HooksView.module.css";

interface BannerState {
  kind: GitErrorKind;
  message: string;
}

type Tab = "stderr" | "stdout";

interface Props {
  sessionId: string;
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export function HooksView({ sessionId }: Props) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stdout");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await gitListHooks(sessionId);
      setHooks(list);
      setLoading(false);
      if (active && !list.find((h) => h.name === active)) {
        setActive(null);
      }
    } catch (err) {
      handleErr(err, setBanner);
      setLoading(false);
    }
  }, [sessionId, active]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runHook = useCallback(
    async (name: string) => {
      setBanner(null);
      setBusy(true);
      try {
        await gitRunHook(sessionId, { name });
        setActive(name);
        await refresh();
      } catch (err) {
        handleErr(err, setBanner);
      } finally {
        setBusy(false);
      }
    },
    [sessionId, refresh],
  );

  if (loading) {
    return <GitSkeleton variant="commit-log" />;
  }

  const activeHook = active ? hooks.find((h) => h.name === active) : null;

  return (
    <div className={styles.container}>
      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          onDismiss={() => setBanner(null)}
        />
      )}

      {hooks.length === 0 ? (
        <div className={styles.empty}>
          No hooks installed. Add an executable file under{" "}
          <code>.git/hooks/</code> to run it from here.
        </div>
      ) : (
        <div className={styles.scroll}>
          {hooks.map((h) => (
            <div
              key={h.name}
              className={`${styles.row} ${active === h.name ? styles.rowActive : ""}`}
              onClick={() => setActive(h.name)}
            >
              <span className={styles.name}>{h.name}</span>
              <span className={styles.meta}>
                {h.executable ? "executable" : "not executable"}
                {h.lastOutput
                  ? ` · last run ${formatTimestamp(h.lastOutput.ranAt)} · exit ${h.lastOutput.exitCode}`
                  : ""}
              </span>
              <button
                type="button"
                className={styles.button}
                disabled={busy || !h.executable}
                onClick={(e) => {
                  e.stopPropagation();
                  runHook(h.name);
                }}
              >
                Run
              </button>
            </div>
          ))}
        </div>
      )}

      {activeHook?.lastOutput && (
        <div className={styles.detail}>
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${tab === "stdout" ? styles.tabActive : ""}`}
              onClick={() => setTab("stdout")}
            >
              stdout
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === "stderr" ? styles.tabActive : ""}`}
              onClick={() => setTab("stderr")}
            >
              stderr
            </button>
            <span className={styles.exit}>
              exit {activeHook.lastOutput.exitCode}
            </span>
          </div>
          <pre className={styles.output}>
            {tab === "stdout"
              ? activeHook.lastOutput.stdout || "(empty)"
              : activeHook.lastOutput.stderr || "(empty)"}
          </pre>
        </div>
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
