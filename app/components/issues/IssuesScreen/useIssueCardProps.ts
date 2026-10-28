import type { LinearIssue } from "../../../lib/types";
import type { IssueCardProps } from "@argus/peacock";
import {
  cycleLabel,
  formatIssueDate,
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
    cycle: cycleLabel(issue.cycle),
    estimate: issue.estimate,
    footnote: `Created ${formatIssueDate(issue.createdAt)}`,
    identifier: issue.identifier,
    labels: issue.labels,
    parent: issue.parent?.identifier ?? null,
    priority: issue.priority,
    project: issue.project?.name ?? null,
    pullRequestCount: issue.pullRequestCount,
    statusType: issue.state.type,
    title: issue.title,
  });
}
