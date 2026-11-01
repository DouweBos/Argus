/**
 * The desktop's inbox groups as Peacock `InboxView` rows: names joined from
 * the automation list, sessions from the session store, and the openers.
 */

import type { AutomationRun, Proposal } from "../../../lib/types";
import type {
  InboxClearedItem,
  InboxRunItem,
  InboxStartedItem,
} from "@argus/peacock";
import { formatRelative, reportPreview } from "../../../lib/automations";
import {
  dismissRun,
  markRunRead,
  openAutomationRun,
  openQuickRun,
  useAutomations,
} from "../../../stores/automationStore";
import { openProposal } from "../../../stores/proposalStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { useCommitsAhead } from "./useCommitsAhead";

/** Runs that did not finish — the automation itself needs attention. */
export function useFailedRunItems(runs: AutomationRun[]): InboxRunItem[] {
  const automations = useAutomations();

  return runs.map((run) => ({
    id: run.id,
    title:
      automations.find((a) => a.id === run.automation_id)?.name ??
      "Deleted automation",
    subtitle: run.error ?? "No error recorded.",
    when: formatRelative(run.started_at),
    onOpen: () => openAutomationRun(run.automation_id, run.id),
    onDismiss: () => dismissRun(run.id),
  }));
}

/** Finished runs with a report nobody has opened yet. */
export function useReportItems(runs: AutomationRun[]): InboxRunItem[] {
  const automations = useAutomations();

  return runs.map((run) => ({
    id: run.id,
    title:
      run.scratch?.name ??
      automations.find((a) => a.id === run.automation_id)?.name ??
      "Quick run",
    subtitle: reportPreview(run),
    when: formatRelative(run.started_at),
    onOpen: () =>
      run.scratch
        ? openQuickRun(run.id)
        : openAutomationRun(run.automation_id, run.id),
    onDismiss: () => markRunRead(run.id),
  }));
}

/**
 * Work Argus started off a proposal, sorted so branches with commits waiting
 * come first: a finished branch is a decision, an in-flight one is not.
 */
export function useStartedItems(proposals: Proposal[]): InboxStartedItem[] {
  const sessions = useSessions();
  const ahead = useCommitsAhead(
    proposals
      .map((p) => p.session_id)
      .filter((id): id is string => id !== null),
  );
  const commitsOf = (p: Proposal) => ahead[p.session_id ?? ""] ?? 0;

  return [...proposals]
    .sort((a, b) => commitsOf(b) - commitsOf(a))
    .map((proposal) => {
      const sessionId = proposal.session_id ?? "";
      const session = sessions.find((s) => s.id === sessionId);
      const commits = commitsOf(proposal);
      const project = session?.repo_root.split("/").filter(Boolean).pop();

      return {
        id: proposal.id,
        title: proposal.title,
        subtitle: session && `${project ?? ""} · ${session.branch}`,
        badge:
          commits > 0
            ? {
                label: `${commits} commit${commits === 1 ? "" : "s"} ready`,
                tone: "success" as const,
              }
            : {
                label:
                  proposal.status === "auto_started"
                    ? "auto-started"
                    : "in progress",
                tone: "neutral" as const,
              },
        actionLabel: commits > 0 ? "Review" : "Open",
        onOpen: () => selectSession(sessionId),
      };
    });
}

/**
 * Decisions a later run took off your hands. Listed rather than silently
 * dropped: a proposal disappearing on its own is only trustworthy if you can
 * see it did.
 */
export function useClearedItems(proposals: Proposal[]): InboxClearedItem[] {
  const automations = useAutomations();

  return proposals.map((proposal) => {
    const automation = automations.find((a) => a.id === proposal.automation_id);
    const parts = [
      proposal.cleared_reason ?? "No reason recorded.",
      automation?.name,
      proposal.cleared_at !== null ? formatRelative(proposal.cleared_at) : null,
    ];

    return {
      id: proposal.id,
      title: proposal.title,
      subtitle: parts.filter(Boolean).join(" · "),
      badge: proposal.status === "superseded" ? "replaced" : "withdrawn",
      onOpen: () => openProposal(proposal.id),
    };
  });
}
