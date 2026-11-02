import type { LinearIssue } from "../../../lib/types";
import { issueCardData, sessionForIssue } from "@argus/client-core";
import { useSessions } from "../../../stores/sessionStore";

/** What a card shows for an issue, including whether an agent is on it. */
export function useIssueCardProps() {
  const sessions = useSessions();

  return (issue: LinearIssue) =>
    issueCardData(issue, sessionForIssue(issue, sessions) !== null);
}
