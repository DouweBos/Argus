import { useEffect, useState } from "react";
import { listen } from "../lib/events";
import { watchSession } from "../lib/ipc";
import { type Session, isSessionReady } from "../lib/types";

export interface SessionDiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export function useSessionDiffStats(
  sessionId: string,
  status: Session["status"],
): SessionDiffStats | null {
  const [diffStats, setDiffStats] = useState<SessionDiffStats | null>(null);

  useEffect(() => {
    if (!isSessionReady(status)) {
      return;
    }
    let cancelled = false;

    const unlistenPromise = listen<SessionDiffStats>(
      `session:diff-changed:${sessionId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );

    watchSession(sessionId).catch(() => {
      // silently ignore — session may have been deleted
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [sessionId, status]);

  return diffStats;
}
