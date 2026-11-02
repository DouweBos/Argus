import type {
  LinearHistoryEvent,
  LinearIssueDetail,
} from "@argus/remote-protocol";
import { AgentIcon, AgentStartIcon, ArrowUpRightIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { LabelChip } from "../LabelChip/LabelChip";
import { PRIORITY_LABELS, PriorityIcon } from "../PriorityIcon/PriorityIcon";
import styles from "./IssueDetail.module.css";
import {
  type IssueStatusStint,
  LastChangeCard,
  TimeInStatusCard,
} from "./IssuePropertyCards";
import { IssuePropertyMenu } from "./IssuePropertyMenu";

/** One pickable value: a workflow state's id or a priority's number, with its digit. */
export interface IssuePropertyChoice {
  id: string;
  key: string | null;
  title: string;
}

export interface IssueStatusChoice extends IssuePropertyChoice {
  color: string | null;
  type: string;
}

export interface IssuePropertiesProps {
  ago: (epochMs: number) => string;
  /** False shows the values without their menus. */
  canEdit: boolean;
  /** "Sprint 4", or null without a cycle. */
  cycleLabel: string | null;
  error?: string | null;
  /** "M", "3 pt", or null without an estimate. */
  estimateLabel: string | null;
  formatDate: (epochMs: number) => string;
  issue: LinearIssueDetail;
  onChange: (patch: { priority?: number; stateId?: string }) => void;
  onOpenExternal: () => void;
  /** Set when a session is already on the issue: open it instead of starting one. */
  onOpenSession: (() => void) | null;
  /** Null when there's nowhere to start an agent. */
  onStart: (() => void) | null;
  priorityChange: LinearHistoryEvent | null;
  priorityOptions: IssuePropertyChoice[];
  statusOptions: IssueStatusChoice[];
  statusStints: IssueStatusStint[];
}

/** Status and priority you can change, the rest at a glance, and what to do next. */
export function IssueProperties({
  ago,
  canEdit,
  cycleLabel,
  error,
  estimateLabel,
  formatDate,
  issue,
  onChange,
  onOpenExternal,
  onOpenSession,
  onStart,
  priorityChange,
  priorityOptions,
  statusOptions,
  statusStints,
}: IssuePropertiesProps) {
  const statuses = statusOptions.length
    ? statusOptions
    : [{ ...issue.state, title: issue.state.name, key: null, color: null }];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.actions}>
        {onOpenSession ? (
          <Button
            variant="primary"
            leading={<AgentIcon size={12} />}
            onClick={onOpenSession}
          >
            Open session
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!onStart}
            leading={<AgentStartIcon size={12} />}
            onClick={() => onStart?.()}
          >
            Start agent
          </Button>
        )}
        <Button
          variant="secondary"
          leading={<ArrowUpRightIcon size={12} />}
          onClick={onOpenExternal}
        >
          Open in Linear
        </Button>
      </div>

      <dl className={styles.properties}>
        <dt>Status</dt>
        <dd className={styles.menuValue}>
          <IssuePropertyMenu
            card={<TimeInStatusCard stints={statusStints} />}
            disabled={!canEdit}
            hotkey="S"
            icon={
              <IssueStatusIcon
                color={issue.state.color}
                type={issue.state.type}
              />
            }
            items={statuses.map((s) => ({
              value: s.id,
              label: s.title,
              icon: <IssueStatusIcon color={s.color} type={s.type} />,
              shortcut: s.key ?? undefined,
            }))}
            label={issue.state.name}
            placeholder="Change status…"
            selected={issue.state.id}
            onSelect={(stateId) => onChange({ stateId })}
          />
        </dd>
        <dt>Priority</dt>
        <dd className={styles.menuValue}>
          <IssuePropertyMenu
            card={
              <LastChangeCard
                ago={ago}
                change={priorityChange}
                title="Priority"
              />
            }
            disabled={!canEdit}
            hotkey="P"
            icon={<PriorityIcon priority={issue.priority} />}
            items={priorityOptions.map((p) => ({
              value: p.id,
              label: p.title,
              icon: <PriorityIcon priority={Number(p.id)} />,
              shortcut: p.key ?? undefined,
            }))}
            label={PRIORITY_LABELS[issue.priority] ?? "No priority"}
            placeholder="Change priority…"
            selected={String(issue.priority)}
            onSelect={(p) => onChange({ priority: Number(p) })}
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
        {cycleLabel && (
          <>
            <dt>Cycle</dt>
            <dd>
              {cycleLabel}
              {issue.cycle?.isActive && (
                <span className={styles.muted}> · current</span>
              )}
            </dd>
          </>
        )}
        {estimateLabel && (
          <>
            <dt>Estimate</dt>
            <dd>{estimateLabel}</dd>
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
        <dd>{formatDate(issue.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatDate(issue.updatedAt)}</dd>
      </dl>
      {error && <p className={styles.error}>{error}</p>}
    </aside>
  );
}
