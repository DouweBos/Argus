import type { LinearIssue } from "../../../lib/types";
import type { IssueCardProps } from "@argus/peacock";
import { estimateName } from "@argus/remote-protocol";
import {
  cycleLabel,
  formatIssueMonth,
  sessionForIssue,
} from "../../../lib/issueBoard";
import { useSessions } from "../../../stores/sessionStore";

/** What a card shows for an issue, including whether an agent is on it. */
export function useIssueCardProps() {
  const sessions = useSessions();

  return (
    issue: LinearIssue,
  ): Omit<IssueCardProps, "onClick" | "selected"> => ({
    assignee: issue.assignee
      ? { name: issue.assignee, avatarUrl: issue.assigneeAvatarUrl }
      : null,
    badge: sessionForIssue(issue, sessions) ? "Agent on it" : undefined,
    // Linear names cycles "Cycle 59"; their `number` counts differently.
    cycle: cycleLabel(issue.cycle)?.replace(/^Cycle /, "") ?? null,
    estimate:
      issue.estimate == null
        ? null
        : estimateName(issue.estimate, issue.estimateType),
    footnote: `Created ${formatIssueMonth(issue.createdAt)}`,
    identifier: issue.identifier,
    labels: issue.labels.map((name) => ({
      name,
      color: issue.labelColors?.find((l) => l.name === name)?.color,
    })),
    parent: issue.parent?.identifier ?? null,
    priority: issue.priority,
    project: issue.project?.name ?? null,
    pullRequestCount: issue.pullRequestCount,
    statusColor: issue.state.color,
    statusType: issue.state.type,
    title: issue.title,
  });
}
