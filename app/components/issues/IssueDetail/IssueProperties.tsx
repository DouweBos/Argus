import type { LinearIssueDetail } from "../../../lib/types";
import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Icons,
  IssueStatusIcon,
  LabelChip,
  PRIORITY_LABELS,
  PriorityIcon,
} from "@argus/peacock";
import { estimateName } from "@argus/remote-protocol";
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
import { LastChangeCard, TimeInStatusCard } from "./IssuePropertyCards";
import { IssuePropertyMenu } from "./IssuePropertyMenu";

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
        <dd className={styles.menuValue}>
          <IssuePropertyMenu
            card={<TimeInStatusCard issue={issue} />}
            hotkey="S"
            icon={
              <IssueStatusIcon
                color={issue.state.color}
                type={issue.state.type}
              />
            }
            items={(states ?? [issue.state]).map((s, i) => ({
              value: s.id,
              label: s.name,
              icon: <IssueStatusIcon color={s.color} type={s.type} />,
              shortcut: i < 10 ? String((i + 1) % 10) : undefined,
            }))}
            label={issue.state.name}
            placeholder="Change status…"
            selected={issue.state.id}
            onSelect={(stateId) => change({ stateId })}
          />
        </dd>
        <dt>Priority</dt>
        <dd className={styles.menuValue}>
          <IssuePropertyMenu
            card={
              <LastChangeCard issue={issue} kind="priority" title="Priority" />
            }
            hotkey="P"
            icon={<PriorityIcon priority={issue.priority} />}
            items={[0, ...PRIORITY_ORDER.slice(0, -1)].map((p) => ({
              value: String(p),
              label: PRIORITY_LABELS[p],
              icon: <PriorityIcon priority={p} />,
              shortcut: String(p),
            }))}
            label={PRIORITY_LABELS[issue.priority] ?? "No priority"}
            placeholder="Change priority…"
            selected={String(issue.priority)}
            onSelect={(p) => change({ priority: Number(p) })}
          />
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
            <dd>{estimateName(issue.estimate, issue.estimateType)}</dd>
          </>
        )}
        {issue.labels.length > 0 && (
          <>
            <dt>Labels</dt>
            <dd className={styles.labels}>
              {issue.labels.map((l) => (
                <LabelChip
                  key={l}
                  color={issue.labelColors?.find((c) => c.name === l)?.color}
                  name={l}
                />
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
