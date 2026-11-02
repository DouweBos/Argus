/**
 * A session known only by id, from whichever project's list holds it. Lists
 * every project's sessions once when none does yet (a link opened cold).
 */

import { useEffect, useState } from "react";
import type { RemoteSession } from "../../lib/protocol";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";

/** The session; undefined while looking, null once every list said no. */
export function useHeldSession(
  sessionId: string,
): RemoteSession | null | undefined {
  const connection = useConnectionStore((s) => s.connection);
  const session = useProjectsStore((s) => {
    for (const list of Object.values(s.sessionsByRepo)) {
      const found = list.find((x) => x.id === sessionId);
      if (found) {
        return found;
      }
    }

    return undefined;
  });
  const [searched, setSearched] = useState<string | null>(null);

  useEffect(() => {
    if (connection !== "ready" || session || searched === sessionId) {
      return;
    }
    let cancelled = false;
    const projects = useProjectsStore.getState();
    projects
      .refreshProjects({ background: true })
      .catch(() => {})
      .then(() =>
        Promise.all(
          useProjectsStore
            .getState()
            .projects.map((p) => projects.loadSessions(p.repo_root).catch(() => {})),
        ),
      )
      .finally(() => {
        if (!cancelled) {
          setSearched(sessionId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection, searched, session, sessionId]);

  if (session) {
    return session;
  }

  return searched === sessionId ? null : undefined;
}
