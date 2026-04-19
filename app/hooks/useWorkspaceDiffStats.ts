import { useEffect, useState } from "react";
import { listen } from "../lib/events";
import { watchWorkspace } from "../lib/ipc";
import { type Workspace, isWorkspaceReady } from "../lib/types";

export interface WorkspaceDiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export function useWorkspaceDiffStats(
  workspaceId: string,
  status: Workspace["status"],
): WorkspaceDiffStats | null {
  const [diffStats, setDiffStats] = useState<WorkspaceDiffStats | null>(null);

  useEffect(() => {
    if (!isWorkspaceReady(status)) {
      return;
    }
    let cancelled = false;

    const unlistenPromise = listen<WorkspaceDiffStats>(
      `workspace:diff-changed:${workspaceId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );

    watchWorkspace(workspaceId).catch(() => {
      // silently ignore — workspace may have been deleted
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [workspaceId, status]);

  return diffStats;
}
