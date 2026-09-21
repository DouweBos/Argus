import type { ReleaseNoteEntry } from "../lib/types";
import { useEffect, useState } from "react";
import { getSessionReleaseNotes } from "../lib/ipc";
import { subscribe } from "../lib/transport";

/**
 * Subscribe to the glob-driven release-note files for a session. Re-scans
 * whenever the session diff changes (a file gets added/modified) or a merge
 * completes (the next branch starts from a fresh merge-base).
 *
 * Returns an empty list when the project hasn't configured
 * `release_note_patterns` in `.argus.json` — callers fall back to the
 * changesets list in that case.
 */
export function useSessionReleaseNotes(sessionId: string): ReleaseNoteEntry[] {
  const [entries, setEntries] = useState<ReleaseNoteEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      getSessionReleaseNotes(sessionId)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setEntries(result.usesReleaseNotes ? result.entries : []);
        })
        .catch(() => {
          // Ignore — UI falls back to an empty list.
        });

    load();

    const unlistenDiff = subscribe(`session:diff-changed:${sessionId}`, () =>
      load(),
    );
    const unlistenMerged = subscribe("session:merged", () => load());

    return () => {
      cancelled = true;
      unlistenDiff();
      unlistenMerged();
    };
  }, [sessionId]);

  return entries;
}
