import type { LinearIssueDetail } from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Icons,
  IssueStatusIcon,
  PRIORITY_LABELS,
  PriorityIcon,
  Select,
} from "@argus/peacock";
import { openExternalUrl } from "../../../lib/ipc";
import {
  cycleLabel,
  formatIssueDate,
  PRIORITY_ORDER,
  sessionForIssue,
} from "../../../lib/issueBoard";
import {
  changeLinearIssue,
  loadTeamStates,
  useTeamStates,
} from "../../../stores/linearIssuesStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "./IssueDetail.module.css";

interface IssuePropertiesProps {
  issue: LinearIssueDetail;
  onStart: ((identifier: string) => void) | null;
}

/** Status and priority you can change, the rest at a glance, and what to do next. */
export function IssueProperties({ issue, onStart }: IssuePropertiesProps) {
  const states = useTeamStates(issue.teamId);
  const session = sessionForIssue(issue, useSessions());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTeamStates(issue.teamId).catch(() => {});
  }, [issue.teamId]);

  const change = (patch: { priority?: number; stateId?: string }) => {
    setError(null);
    changeLinearIssue(issue.id, patch).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.actions}>
        {session ? (
          <Button
            variant="primary"
            leading={<Icons.AgentIcon size={12} />}
            onClick={() => selectSession(session.id)}
          >
            Open session
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!onStart}
            leading={<Icons.AgentStartIcon size={12} />}
            onClick={() => onStart?.(issue.identifier)}
          >
            Start agent
          </Button>
        )}
        <Button
          variant="secondary"
          leading={<Icons.ArrowUpRightIcon size={12} />}
          onClick={() => openExternalUrl(issue.url).catch(() => {})}
        >
          Open in Linear
        </Button>
      </div>

      <dl className={styles.properties}>
        <dt>Status</dt>
        <dd className={styles.withIcon}>
          <IssueStatusIcon type={issue.state.type} />
          <Select
            aria-label="Status"
            value={issue.state.id}
            onChange={(e) => change({ stateId: e.target.value })}
          >
            {(states ?? [issue.state]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </dd>
        <dt>Priority</dt>
        <dd className={styles.withIcon}>
          <PriorityIcon priority={issue.priority} />
          <Select
            aria-label="Priority"
            value={String(issue.priority)}
            onChange={(e) => change({ priority: Number(e.target.value) })}
          >
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </dd>
        <dt>Assignee</dt>
        <dd className={styles.withIcon}>
          {issue.assignee ? (
            <>
              <Avatar
                name={issue.assignee}
                size={18}
                src={issue.assigneeAvatarUrl}
              />
              {issue.assignee}
            </>
          ) : (
            <span className={styles.muted}>Unassigned</span>
          )}
        </dd>
        <dt>Team</dt>
        <dd>{issue.teamName}</dd>
        {issue.project && (
          <>
            <dt>Project</dt>
            <dd>{issue.project.name}</dd>
          </>
        )}
        {issue.cycle && (
          <>
            <dt>Cycle</dt>
            <dd>
              {cycleLabel(issue.cycle)}
              {issue.cycle.isActive && (
                <span className={styles.muted}> · current</span>
              )}
            </dd>
          </>
        )}
        {issue.estimate != null && (
          <>
            <dt>Estimate</dt>
            <dd>{issue.estimate} pt</dd>
          </>
        )}
        {issue.labels.length > 0 && (
          <>
            <dt>Labels</dt>
            <dd className={styles.labels}>
              {issue.labels.map((l) => (
                <span key={l} className={styles.label}>
                  {l}
                </span>
              ))}
            </dd>
          </>
        )}
        <dt>Branch</dt>
        <dd className={styles.mono}>{issue.branchName}</dd>
        <dt>Created</dt>
        <dd>{formatIssueDate(issue.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatIssueDate(issue.updatedAt)}</dd>
      </dl>
      {error && <p className={styles.error}>{error}</p>}
    </aside>
  );
}
