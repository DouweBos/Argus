import type { Session } from "../../../lib/types";
import { Chip, Icons } from "@argus/peacock";
import { openDesignViewer } from "../../../lib/designViewer";
import { LinkedIssueChip } from "../LinkedIssueChip/LinkedIssueChip";

/** What a session was started from: its issue, and the Figma frames it builds against. */
export function SessionReferenceChips({
  session,
}: {
  session: Pick<Session, "design_refs" | "id" | "linked_issue">;
}) {
  return (
    <>
      {session.linked_issue && <LinkedIssueChip issue={session.linked_issue} />}
      {session.design_refs?.map((ref) => (
        <Chip
          key={ref.url}
          interactive
          leading={<Icons.FigmaIcon size={10} />}
          title={`${ref.name} — open in the design viewer`}
          onClick={() => openDesignViewer(ref.url, "session", session.id)}
        >
          {ref.name}
        </Chip>
      ))}
    </>
  );
}
