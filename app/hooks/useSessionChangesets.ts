import type { ChangesetEntry } from "../lib/types";
import { useEffect, useState } from "react";
import { getSessionChangesets } from "../lib/ipc";

/**
 * Subscribe to the pending changesets for a session. Re-scans whenever the
 * session tree changes (agent adds/removes a changeset) or a merge completes
 * (changesets get consumed by `changeset version`).
 */
export function useSessionChangesets(sessionId: string): ChangesetEntry[] {
  const [changesets, setChangesets] = useState<ChangesetEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      getSessionChangesets(sessionId)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setChangesets(result.usesChangesets ? result.changesets : []);
        })
        .catch(() => {
          // Ignore — UI falls back to an empty list.
        });

    load();

    const unlistenDiff = window.argus.on(
      `session:diff-changed:${sessionId}`,
      () => load(),
    );
    const unlistenMerged = window.argus.on("session:merged", () => load());

    return () => {
      cancelled = true;
      unlistenDiff();
      unlistenMerged();
    };
  }, [sessionId]);

  return changesets;
}
