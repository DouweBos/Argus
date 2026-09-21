import { useEffect, useState } from "react";
import { getSessionCommitsAhead } from "../../../lib/ipc";

/**
 * Commits each session is ahead of its base, keyed by session id. Scoped to
 * the handful of sessions Argus started itself — a repo-wide merge scan would
 * cost four git calls per session for a screen you glance at.
 */
export function useCommitsAhead(sessionIds: string[]): Record<string, number> {
  const key = sessionIds.join(",");
  const [ahead, setAhead] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    Promise.all(
      ids.map(async (id): Promise<[string, number]> => {
        try {
          return [id, await getSessionCommitsAhead(id)];
        } catch {
          return [id, 0];
        }
      }),
    )
      .then((entries) => {
        if (!cancelled) {
          setAhead(Object.fromEntries(entries));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [key]);

  return ahead;
}
