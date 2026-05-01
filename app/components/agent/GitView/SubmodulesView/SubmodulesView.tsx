/**
 * Phase 6B P9 — project-scope submodules view.
 *
 * Lists submodules with status badges; per-row actions for init / update /
 * update --remote / deinit. Project-scope only (mounted from `GitView.tsx`).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  DestructiveConfirm,
  GitErrorBanner,
  GitSkeleton,
  type BadgeTone,
  type GitErrorKind,
} from "@argus/peacock";
import { GitError } from "../../../../lib/gitError";
import {
  gitSubmoduleDeinit,
  gitSubmoduleInit,
  gitSubmoduleList,
  gitSubmoduleUpdate,
  type GitSubmodule,
  type SubmoduleStatus,
} from "../../../../lib/ipc";
import styles from "./SubmodulesView.module.css";

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
}

const STATUS_TONE: Record<SubmoduleStatus, BadgeTone> = {
  clean: "success",
  modified: "warning",
  uninitialized: "neutral",
};

export function SubmodulesView({ sessionId }: { sessionId: string }) {
  const [submodules, setSubmodules] = useState<GitSubmodule[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [deinitTarget, setDeinitTarget] = useState<GitSubmodule | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await gitSubmoduleList(sessionId);
      setSubmodules(list);
      setLoading(false);
    } catch (err) {
      handleErr(err, setBanner);
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       Initial fetch on mount; refresh wraps async load. */
    refresh();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [refresh]);

  const runOp = useCallback(
    async (op: () => Promise<unknown>) => {
      setBanner(null);
      try {
        await op();
        await refresh();
      } catch (err) {
        handleErr(err, setBanner);
      }
    },
    [refresh],
  );

  if (loading) {
    return <GitSkeleton variant="commit-log" />;
  }

  if (submodules.length === 0) {
    return (
      <div className={styles.container}>
        {banner && (
          <GitErrorBanner
            kind={banner.kind}
            message={banner.message}
            recovery={banner.recovery}
            onDismiss={() => setBanner(null)}
          />
        )}
        <div className={styles.empty}>No submodules in this repo.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {banner && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          recovery={banner.recovery}
          onDismiss={() => setBanner(null)}
        />
      )}

      <div className={styles.scroll}>
        {submodules.map((s) => (
          <div key={s.name} className={styles.row}>
            <div>
              <div>{s.name}</div>
              <div className={styles.url} title={s.url}>
                {s.url}
              </div>
            </div>
            <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
            <span className={styles.path}>{s.path}</span>
            <div className={styles.actions}>
              {s.status === "uninitialized" && (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() =>
                    runOp(() => gitSubmoduleInit(sessionId, { path: s.path }))
                  }
                >
                  Init
                </button>
              )}
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  runOp(() => gitSubmoduleUpdate(sessionId, { path: s.path }))
                }
              >
                Update
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  runOp(() =>
                    gitSubmoduleUpdate(sessionId, {
                      path: s.path,
                      remote: true,
                    }),
                  )
                }
              >
                Update --remote
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => setDeinitTarget(s)}
              >
                Deinit…
              </button>
            </div>
          </div>
        ))}
      </div>

      <DestructiveConfirm
        open={Boolean(deinitTarget)}
        title="Deinit submodule?"
        description={
          deinitTarget
            ? `Deinit ${deinitTarget.path}? This removes the working tree but keeps the .gitmodules entry.`
            : ""
        }
        confirmLabel="Deinit"
        tone="warning"
        onConfirm={() => {
          const target = deinitTarget;
          setDeinitTarget(null);
          if (!target) {
            return;
          }
          runOp(() =>
            gitSubmoduleDeinit(sessionId, { path: target.path, force: true }),
          );
        }}
        onCancel={() => setDeinitTarget(null)}
      />
    </div>
  );
}

function handleErr(err: unknown, setBanner: (b: BannerState) => void): void {
  if (err instanceof GitError) {
    setBanner({ kind: err.kind, message: err.message, recovery: err.recovery });
  } else {
    setBanner({
      kind: "unknown",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
