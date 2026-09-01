/** List rows for agents and sessions (phone twins of Peacock's AgentRow/SessionCard). */

import type { ReactNode } from "react";
import { View } from "react-native";
import * as Icons from "./Icons";
import {
  Badge,
  Body,
  Card,
  Chip,
  IconBtn,
  Muted,
  Row,
  StatusDot,
  type Tone,
} from "./ui";
import { useTheme } from "../theme";

export type AgentStatusTone = "done" | "error" | "idle" | "pending" | "running";

export function mapAgentStatus(status: string): AgentStatusTone {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "pending";
    case "error":
      return "error";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

/**
 * Sort weight for the agent lists — anything that wants you (needs input) or is
 * mid-flight outranks the idle and finished ones, however recent those are.
 */
export function agentActivityRank(status: string): number {
  switch (status) {
    case "requires_action":
      return 0;
    case "running":
      return 1;
    case "error":
      return 2;
    case "stopped":
      return 4;
    default:
      return 3;
  }
}

export function agentMetaLabel(status: string): string {
  switch (status) {
    case "running":
      return "running";
    case "requires_action":
      return "needs input";
    case "error":
      return "blocked";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

function statusTone(status: AgentStatusTone): Tone {
  switch (status) {
    case "running":
      return "accent";
    case "pending":
      return "warning";
    case "error":
      return "danger";
    case "done":
      return "success";
    default:
      return "muted";
  }
}

export function AgentRow({
  name,
  status,
  meta,
  model,
  onPress,
}: {
  name: string;
  status: AgentStatusTone;
  meta?: string;
  model?: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Card onPress={onPress} style={{ paddingVertical: 10 }}>
      <Row gap={9}>
        <StatusDot tone={statusTone(status)} pulse={status === "running"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Body numberOfLines={1}>{name}</Body>
          <Row gap={6}>
            {meta ? <Muted>{meta}</Muted> : null}
            {model ? <Muted numberOfLines={1}>· {model}</Muted> : null}
          </Row>
        </View>
        <Icons.ChevronRight size={14} color={theme.textMuted} />
      </Row>
    </Card>
  );
}

/** "just now" / "12m ago" / "3h ago" / "yesterday" — matches the desktop's home. */
export function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) {
    return "just now";
  }
  const m = Math.floor(delta / 60_000);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);

  return d === 1 ? "yesterday" : `${d}d ago`;
}

/** A finished agent from the computer's saved history — read-only, no status. */
export function StoppedAgentRow({
  title,
  branch,
  endedAt,
  messageCount,
  onPress,
}: {
  title: string;
  branch: string;
  endedAt: number;
  messageCount: number;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Card onPress={onPress} style={{ paddingVertical: 10 }}>
      <Row gap={9}>
        <Icons.History size={15} color={theme.textMuted} />
        <View style={{ flex: 1, gap: 2 }}>
          <Body numberOfLines={1}>{title}</Body>
          <Row gap={6}>
            <Muted>{timeAgo(endedAt)}</Muted>
            <Muted numberOfLines={1}>
              · {messageCount} message{messageCount === 1 ? "" : "s"}
            </Muted>
            {branch ? <Muted numberOfLines={1}>· {branch}</Muted> : null}
          </Row>
        </View>
        <Icons.ChevronRight size={14} color={theme.textMuted} />
      </Row>
    </Card>
  );
}

export function SessionCard({
  title,
  branch,
  kind,
  status,
  additions,
  deletions,
  divergence,
  onActions,
  children,
}: {
  title: string;
  branch?: string;
  kind?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  divergence?: { ahead: number; behind: number; dirty: number };
  onActions?: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const isRoot = kind === "project_root";

  return (
    <Card style={{ gap: 10 }}>
      <Row gap={8}>
        {isRoot ? (
          <Icons.Repo size={14} color={theme.textSecondary} />
        ) : (
          <Icons.Branch size={14} color={theme.textSecondary} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Body numberOfLines={1} style={{ fontWeight: "600" }}>
            {title}
          </Body>
          {branch && branch !== title ? (
            <Muted numberOfLines={1}>{branch}</Muted>
          ) : null}
        </View>
        {isRoot ? <Badge label="root" tone="accent" /> : null}
        {kind === "worktree" ? <Badge label="worktree" /> : null}
        {status && status !== "ready" ? <Badge label={status} /> : null}
        {onActions ? (
          <IconBtn label="Session actions" onPress={onActions}>
            <Icons.Ellipsis size={16} color={theme.textMuted} />
          </IconBtn>
        ) : null}
      </Row>

      {(additions || deletions || divergence) && (
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          {additions ? (
            <Chip label={`+${additions}`} tone="success" mono />
          ) : null}
          {deletions ? (
            <Chip label={`-${deletions}`} tone="danger" mono />
          ) : null}
          {divergence && divergence.ahead > 0 ? (
            <Chip label={`↑${divergence.ahead}`} mono />
          ) : null}
          {divergence && divergence.behind > 0 ? (
            <Chip label={`↓${divergence.behind}`} mono />
          ) : null}
          {divergence && divergence.dirty > 0 ? (
            <Chip label={`${divergence.dirty} changed`} tone="warning" />
          ) : null}
        </Row>
      )}

      {children}
    </Card>
  );
}
