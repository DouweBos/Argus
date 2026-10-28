import type { LinearIssue, Session } from "../../../lib/types";
import { type ReactNode, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GridScreen,
  Icons,
  Select,
  Spinner,
} from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  refreshLinearIssues,
  useLinearIssues,
} from "../../../stores/linearIssuesStore";
import {
  selectSession,
  useSessionProjects,
  useSessions,
} from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { openStartDraft } from "../../../stores/startDraftStore";
import styles from "./IssuesScreen.module.css";

/** Linear's workflow state types, in the order work moves through them. */
const GROUPS: { title: string; types: string[] }[] = [
  { title: "In progress", types: ["started"] },
  { title: "Todo", types: ["unstarted"] },
  { title: "Backlog", types: ["backlog", "triage"] },
];

const PRIORITY: Record<number, string> = {
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** The session already working on the issue, if any. */
function sessionFor(issue: LinearIssue, sessions: Session[]): Session | null {
  return (
    sessions.find(
      (s) =>
        s.linked_issue?.identifier === issue.identifier ||
        (s.kind === "worktree" && s.branch === issue.branchName),
    ) ?? null
  );
}

function IssueRow({
  issue,
  session,
  onStart,
}: {
  issue: LinearIssue;
  onStart: (() => void) | null;
  session: Session | null;
}) {
  return (
    <Card hoverable className={styles.row}>
      <div className={styles.main}>
        <div className={styles.titleLine}>
          <span className={styles.identifier}>{issue.identifier}</span>
          <span className={styles.title}>{issue.title}</span>
        </div>
        <div className={styles.meta}>
          <span>{issue.state.name}</span>
          {PRIORITY[issue.priority] && (
            <Badge
              tone={issue.priority <= 2 ? "warning" : "neutral"}
              size="tag"
            >
              {PRIORITY[issue.priority]}
            </Badge>
          )}
          {issue.labels.map((label) => (
            <Badge key={label} tone="neutral" size="tag">
              {label}
            </Badge>
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open in Linear"
          title="Open in Linear"
          onClick={() => {
            openExternalUrl(issue.url).catch(() => {});
          }}
        >
          <Icons.ArrowUpRightIcon size={12} />
        </Button>
        {session ? (
          <Button
            variant="secondary"
            size="sm"
            leading={<Icons.AgentIcon size={12} />}
            onClick={() => selectSession(session.id)}
          >
            Open session
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={!onStart}
            leading={<Icons.AgentStartIcon size={12} />}
            onClick={() => onStart?.()}
          >
            Start agent
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Your open Linear issues, with what Argus is doing about each: the session
 * already on it, or a one-click start in the project you pick.
 */
export function IssuesScreen() {
  const { connected, data, error, loading } = useLinearIssues();
  const sessions = useSessions();
  const projects = useSessionProjects();
  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const repoRoot = pickedRoot ?? projects[0]?.repoRoot ?? null;

  const start = (issue: LinearIssue) => {
    if (repoRoot) {
      openStartDraft(repoRoot, {
        issueRefs: [issue.identifier],
        workspace: "worktree",
      }).catch(() => {});
    }
  };

  let content: ReactNode;
  if (!connected) {
    content = (
      <EmptyState
        icon={<Icons.LinearIcon size={20} />}
        title="Connect Linear"
        body="See the issues assigned to you, which ones an agent is already on, and start agents from them."
        action={
          <Button
            variant="primary"
            onClick={() => showSettingsDialog("integrations")}
          >
            Open Settings
          </Button>
        }
      />
    );
  } else if (data === null && error) {
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't fetch your issues"
        body={error}
      />
    );
  } else if (data === null) {
    content = (
      <EmptyState
        icon={<Spinner size="md" />}
        title="Loading issues"
        body="Asking Linear for the open issues assigned to you."
      />
    );
  } else if (data.length === 0) {
    content = (
      <EmptyState
        icon={<Icons.CheckIcon size={20} />}
        title="Nothing assigned to you"
        body="Open issues assigned to you in Linear show up here."
      />
    );
  } else {
    content = GROUPS.map((group) => {
      const issues = data.filter((i) => group.types.includes(i.state.type));
      if (issues.length === 0) {
        return null;
      }

      return (
        <GridScreen.Section
          key={group.title}
          title={group.title}
          count={issues.length}
        >
          <GridScreen.Grid>
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                session={sessionFor(issue, sessions)}
                onStart={repoRoot ? () => start(issue) : null}
              />
            ))}
          </GridScreen.Grid>
        </GridScreen.Section>
      );
    });
  }

  return (
    <GridScreen>
      <GridScreen.Header
        title="Issues"
        subtitle="Open issues assigned to you in Linear"
        actions={
          connected && (
            <div className={styles.headerActions}>
              {projects.length > 1 && repoRoot && (
                <Select
                  aria-label="Project to start agents in"
                  value={repoRoot}
                  onChange={(e) => setPickedRoot(e.target.value)}
                >
                  {projects.map((p) => (
                    <option
                      key={`${p.hostId}:${p.repoRoot}`}
                      value={p.repoRoot}
                    >
                      Start in {basename(p.repoRoot)}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={loading}
                leading={<Icons.RefreshIcon size={12} />}
                onClick={() => {
                  refreshLinearIssues().catch(() => {});
                }}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          )
        }
      />
      {content}
    </GridScreen>
  );
}
