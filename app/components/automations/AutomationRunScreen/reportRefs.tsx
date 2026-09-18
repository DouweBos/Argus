import { useCallback } from "react";
import { Badge, type ReportRef } from "@argus/peacock";
import { sessionStatusLabel } from "../../../lib/types";
import { selectSession, useSessions } from "../../../stores/sessionStore";

/**
 * Resolves the ids a report points at against current state, so `proposals`
 * and `sessions` blocks render live cards rather than a snapshot that rots.
 */
export function useReportRefResolvers(): {
  resolveProposal: (id: string) => ReportRef | null;
  resolveSession: (id: string) => ReportRef | null;
} {
  const sessions = useSessions();

  const resolveSession = useCallback(
    (id: string): ReportRef | null => {
      const session = sessions.find((s) => s.id === id);
      if (!session) {
        return null;
      }
      const project = session.repo_root.split("/").filter(Boolean).pop() ?? "";

      return {
        id,
        title: session.display_name ?? session.branch,
        subtitle: project,
        meta: (
          <Badge tone="neutral">{sessionStatusLabel(session.status)}</Badge>
        ),
        onOpen: () => selectSession(id),
      };
    },
    [sessions],
  );

  // Proposals arrive with the inbox. Until their store exists every id
  // resolves to null and the block renders a tombstone instead of a snapshot;
  // wiring it is this one callback.
  const resolveProposal = useCallback((): ReportRef | null => null, []);

  return { resolveProposal, resolveSession };
}
