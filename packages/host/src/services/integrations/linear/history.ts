/**
 * Linear's issue history, phrased the way Linear's own activity feed does:
 * "set priority to High", "moved to Cycle 59". One history entry can carry
 * several changes, so it can become several lines.
 */

import type { RawHistory } from "./queries";
import type { LinearHistoryEvent } from "@argus/remote-protocol";
import { estimateName, PRIORITY_NAMES } from "@argus/remote-protocol";

type Kind = LinearHistoryEvent["kind"];

function cycleName(cycle: { number: number; name?: string | null }): string {
  return cycle.name || `Cycle ${cycle.number}`;
}

function changes(h: RawHistory, estimateType: string | null): [Kind, string][] {
  const out: [Kind, string][] = [];
  if (h.toState) {
    out.push([
      "status",
      h.fromState
        ? `changed status from ${h.fromState.name} to ${h.toState.name}`
        : `set status to ${h.toState.name}`,
    ]);
  }
  if (h.toPriority != null && h.toPriority !== h.fromPriority) {
    out.push([
      "priority",
      h.toPriority === 0
        ? "removed the priority"
        : `set priority to ${PRIORITY_NAMES[h.toPriority] ?? h.toPriority}`,
    ]);
  }
  if (h.toAssignee || h.fromAssignee) {
    out.push([
      "assignee",
      h.toAssignee
        ? `assigned the issue to ${h.toAssignee.displayName}`
        : `unassigned ${h.fromAssignee?.displayName ?? "the issue"}`,
    ]);
  }
  if (h.toEstimate != null || h.fromEstimate != null) {
    out.push([
      "estimate",
      h.toEstimate != null
        ? `set the estimate to ${estimateName(h.toEstimate, estimateType)}`
        : "removed the estimate",
    ]);
  }
  if (h.toCycle && h.fromCycle) {
    out.push([
      "cycle",
      `moved the issue from ${cycleName(h.fromCycle)} to ${cycleName(h.toCycle)}`,
    ]);
  } else if (h.toCycle) {
    out.push(["cycle", `added the issue to ${cycleName(h.toCycle)}`]);
  } else if (h.fromCycle) {
    out.push(["cycle", `removed the issue from ${cycleName(h.fromCycle)}`]);
  }
  if (h.toProject || h.fromProject) {
    out.push([
      "project",
      h.toProject
        ? `added the issue to ${h.toProject.name}`
        : `removed the issue from ${h.fromProject?.name}`,
    ]);
  }
  if (h.toParent || h.fromParent) {
    out.push([
      "parent",
      h.toParent
        ? `made this a sub-issue of ${h.toParent.identifier}`
        : `removed the parent ${h.fromParent?.identifier}`,
    ]);
  }
  if (h.toTitle && h.fromTitle) {
    out.push(["title", `changed the title to ${h.toTitle}`]);
  }
  if (h.updatedDescription) {
    out.push(["description", "updated the description"]);
  }
  if (h.toDueDate !== undefined && h.toDueDate !== h.fromDueDate) {
    out.push([
      "due",
      h.toDueDate
        ? `set the due date to ${h.toDueDate}`
        : "removed the due date",
    ]);
  }
  for (const label of h.addedLabels ?? []) {
    out.push(["labels", `added the label ${label.name}`]);
  }
  for (const label of h.removedLabels ?? []) {
    out.push(["labels", `removed the label ${label.name}`]);
  }
  if (h.attachment) {
    out.push(["attachment", `linked ${h.attachment.title}`]);
  }
  for (const change of h.relationChanges ?? []) {
    out.push([
      "relation",
      change.type.startsWith("r") || change.type.includes("remove")
        ? `removed the relation to ${change.identifier}`
        : `related the issue to ${change.identifier}`,
    ]);
  }

  return out;
}

export function historyEvents(
  h: RawHistory,
  estimateType: string | null,
): LinearHistoryEvent[] {
  return changes(h, estimateType).map(([kind, text], i) => ({
    id: `${h.id}-${i}`,
    createdAt: Date.parse(h.createdAt),
    actor: h.actor?.displayName ?? null,
    actorAvatarUrl: h.actor?.avatarUrl ?? null,
    kind,
    text,
  }));
}
