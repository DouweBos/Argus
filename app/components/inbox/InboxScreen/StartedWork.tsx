import type { Proposal } from "../../../lib/types";
import { Badge, Button, Icons, InboxItemRow } from "@argus/peacock";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "./InboxScreen.module.css";
import { useCommitsAhead } from "./useCommitsAhead";

/**
 * Work Argus started off a proposal, sorted so branches with commits waiting
 * come first: a finished branch is a decision, an in-flight one is not.
 */
export function StartedWork({ proposals }: { proposals: Proposal[] }) {
  const sessions = useSessions();
  const sessionIds = proposals
    .map((p) => p.session_id)
    .filter((id): id is string => id !== null);
  const ahead = useCommitsAhead(sessionIds);

  const rows = [...proposals].sort(
    (a, b) =>
      (ahead[b.session_id ?? ""] ?? 0) - (ahead[a.session_id ?? ""] ?? 0),
  );

  return (
    <div className={styles.rows}>
      {rows.map((proposal) => {
        const sessionId = proposal.session_id ?? "";
        const session = sessions.find((s) => s.id === sessionId);
        const commits = ahead[sessionId] ?? 0;
        const project =
          session?.repo_root.split("/").filter(Boolean).pop() ?? "";

        return (
          <InboxItemRow
            actions={
              <Button
                onClick={() => selectSession(sessionId)}
                size="sm"
                variant="secondary"
              >
                {commits > 0 ? "Review" : "Open"}
              </Button>
            }
            key={proposal.id}
            leading={<Icons.AgentIcon size={12} />}
            meta={
              commits > 0 ? (
                <Badge tone="success">
                  {commits} commit{commits === 1 ? "" : "s"} ready
                </Badge>
              ) : (
                <Badge tone="neutral">
                  {proposal.status === "auto_started"
                    ? "auto-started"
                    : "in progress"}
                </Badge>
              )
            }
            onOpen={() => selectSession(sessionId)}
            subtitle={session && `${project} · ${session.branch}`}
            title={proposal.title}
          />
        );
      })}
    </div>
  );
}
