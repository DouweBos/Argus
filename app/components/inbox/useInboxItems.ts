/**
 * What the inbox is made of — shared with the home screen, so the two never
 * disagree about what counts as waiting on you. The grouping is
 * `@argus/client-core`'s, the same the web client and the phone use.
 */

import type { AutomationRun, Proposal } from "../../lib/types";
import { useEffect, useMemo, useState } from "react";
import {
  inboxGroups,
  type InboxGroups,
  type InboxRunReader,
} from "@argus/client-core";
import { isUnreadReport } from "../../lib/automations";
import { useAllRuns } from "../../stores/automationStore";
import { useProposals } from "../../stores/proposalStore";
import { useSessions } from "../../stores/sessionStore";

export type InboxItems = InboxGroups<Proposal, AutomationRun>;

const CATALOG_RUN_READER: InboxRunReader<AutomationRun> = {
  isRead: (run) => run.report_read,
  hasUnreadReport: isUnreadReport,
};

export function useInboxItems(): InboxItems {
  const proposals = useProposals();
  const sessions = useSessions();
  const runs = useAllRuns();
  // The cut-offs are relative to now, so they have to move while the screen
  // stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return useMemo(
    () =>
      inboxGroups({
        proposals,
        runs,
        reader: CATALOG_RUN_READER,
        sessionIds: new Set(sessions.map((s) => s.id)),
        now,
      }),
    [proposals, runs, sessions, now],
  );
}
