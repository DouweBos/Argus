import type { LinkedIssue } from "../../../lib/types";
import { Chip, Icons } from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";

/** The issue a session was started from; opens it in the tracker. */
export function LinkedIssueChip({ issue }: { issue: LinkedIssue }) {
  return (
    <Chip
      interactive
      mono
      leading={<Icons.LinearIcon size={10} />}
      title={`${issue.title} — open in Linear`}
      onClick={() => {
        openExternalUrl(issue.url).catch(() => {});
      }}
    >
      {issue.identifier}
    </Chip>
  );
}
