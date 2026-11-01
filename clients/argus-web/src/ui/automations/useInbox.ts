/**
 * The inbox as the phone groups it, kept fresh while something shows it. The
 * gateway pushes no proposal or run events, so it polls, as iOS does.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  inboxActionCount,
  inboxGroups,
  REMOTE_RUN_READER,
} from "@argus/client-core";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { inboxProposals, useProposalsStore } from "../../stores/proposals";
import { useLiveRefresh } from "../useLiveRefresh";

/** Slower than the project lists: an inbox changes on the scale of runs. */
export const INBOX_REFRESH_MS = 15_000;

/** Proposals and runs, refetched together; a failure stays in the stores' load state. */
export function useInboxRefresh(): () => void {
  return useCallback(() => {
    void useProposalsStore
      .getState()
      .refresh({ background: true })
      .catch(() => {});
    void useAutomationsStore
      .getState()
      .refresh({ background: true })
      .catch(() => {});
  }, []);
}

/** Sessions that still exist, so started work whose session went leaves the inbox. */
function useKnownSessionIds(): ReadonlySet<string> {
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);

  return useMemo(
    () =>
      new Set([
        ...recentAgents.map((a) => a.session_id),
        ...Object.values(sessionsByRepo)
          .flat()
          .map((s) => s.id),
      ]),
    [recentAgents, sessionsByRepo],
  );
}

export function useInboxGroups() {
  const pending = useProposalsStore((s) => s.pending);
  const recent = useProposalsStore((s) => s.recent);
  const runs = useAutomationsStore((s) => s.runs);
  const sessionIds = useKnownSessionIds();
  // The failure and cleared windows are relative to now.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return useMemo(
    () =>
      inboxGroups({
        proposals: inboxProposals(pending, recent),
        runs,
        reader: REMOTE_RUN_READER,
        sessionIds,
        now,
      }),
    [pending, recent, runs, sessionIds, now],
  );
}

/** What the inbox badge shows, polling in the background while connected. */
export function useInboxBadge(): number {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const refresh = useInboxRefresh();
  useLiveRefresh(ready, refresh, 30_000);

  return inboxActionCount(useInboxGroups());
}
