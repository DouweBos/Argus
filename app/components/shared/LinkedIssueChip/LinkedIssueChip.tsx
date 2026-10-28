import type { LinkedIssue } from "../../../lib/types";
import { Chip, Icons } from "@argus/peacock";
import { appNavigate } from "../../../lib/router";

/** The issue a session was started from; opens it over the Issues board. */
export function LinkedIssueChip({ issue }: { issue: LinkedIssue }) {
  return (
    <Chip
      interactive
      mono
      leading={<Icons.LinearIcon size={10} />}
      title={`${issue.title} — open issue`}
      onClick={() =>
        appNavigate({
          view: "issues",
          issueScope: "assigned",
          issueRef: issue.identifier,
        })
      }
    >
      {issue.identifier}
    </Chip>
  );
}
