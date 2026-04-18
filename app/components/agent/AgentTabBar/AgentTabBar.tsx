import type { AgentStatus } from "../../../lib/types";
import type { StatusDotsState } from "@argus/peacock";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import { Badge, Icons, StatusDots } from "@argus/peacock";
import { reorderAgent, useAgentsRecord } from "../../../stores/agentStore";
import { useConversation } from "../../../stores/conversationStore";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  activeAgentId: string | null;
  agents: AgentStatus[];
  onClose: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

const DRAG_MIME = "application/x-argus-agent-id";

type DropPosition = "after" | "before";

interface DropIndicator {
  position: DropPosition;
  targetAgentId: string;
}

function useTabMeta(
  agentId: string,
  fallback: string,
  status: AgentStatus["status"],
): { fullLabel: string; label: string; state: StatusDotsState } {
  const conv = useConversation(agentId);
  const messages = conv?.messages ?? [];

  let label = fallback;
  let fullLabel = fallback;
  if (conv?.title) {
    const title = conv.title.trim();
    fullLabel = title;
    label = title.length > 24 ? title.slice(0, 24) + "\u2026" : title;
  } else {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser && firstUser.textBlocks.length > 0) {
      const text = firstUser.textBlocks[0].trim();
      fullLabel = text;
      label = text.length > 20 ? text.slice(0, 20) + "\u2026" : text;
    }
  }

  const awaitingPermission = messages.some((m) =>
    m.toolCalls.some((tc) => tc.pendingPermission),
  );

  let state: StatusDotsState = "idle";
  if (awaitingPermission) {
    state = "awaiting";
  } else if (status === "running") {
    state = "running";
  }

  return { fullLabel, label, state };
}

function AgentTab({
  agent,
  index,
  isActive,
  childCount,
  hasParent,
  isDragging,
  dropIndicator,
  onSelect,
  onClose,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  agent: AgentStatus;
  childCount: number;
  dropIndicator: DropPosition | null;
  hasParent: boolean;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  onClose: (id: string) => void;
  onDragEnd: () => void;
  onDragLeave: (id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { fullLabel, label, state } = useTabMeta(
    agent.agent_id,
    `Agent ${index + 1}`,
    agent.status,
  );

  const classes = [
    styles.tab,
    isActive ? styles.active : null,
    isDragging ? styles.dragging : null,
    dropIndicator === "before" ? styles.dropBefore : null,
    dropIndicator === "after" ? styles.dropAfter : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      draggable
      title={fullLabel}
      onClick={() => onSelect(agent.agent_id)}
      onDragStart={(e) => onDragStart(e, agent.agent_id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, agent.agent_id)}
      onDragLeave={() => onDragLeave(agent.agent_id)}
      onDrop={(e) => onDrop(e, agent.agent_id)}
    >
      <StatusDots state={state} className={styles.statusDots} />
      {hasParent && (
        <span className={styles.parentBadge} title="Spawned by another agent">
          &#8618;
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {childCount > 0 && (
        <Badge
          tone="accent"
          size="pill"
          title={`${childCount} child agent${childCount > 1 ? "s" : ""}`}
        >
          {childCount}
        </Badge>
      )}
      <button
        className={styles.closeBtn}
        title="Close agent"
        onClick={(e) => {
          e.stopPropagation();
          onClose(agent.agent_id);
        }}
      >
        <Icons.CloseIcon size={10} />
      </button>
    </div>
  );
}

export function AgentTabBar({
  agents,
  activeAgentId,
  onSelect,
  onClose,
}: AgentTabBarProps) {
  const allAgents = useAgentsRecord();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );

  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of Object.values(allAgents)) {
      if (a.parent_agent_id) {
        counts[a.parent_agent_id] = (counts[a.parent_agent_id] ?? 0) + 1;
      }
    }

    return counts;
  }, [allAgents]);

  const handleDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, id);
    // Some browsers require data on the plain text type for drag to init.
    e.dataTransfer.setData("text/plain", id);
    setDraggingId(id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropIndicator(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
    if (!draggingId || draggingId === id) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const isBefore = e.clientX < rect.left + rect.width / 2;
    const position: DropPosition = isBefore ? "before" : "after";
    setDropIndicator((prev) =>
      prev && prev.targetAgentId === id && prev.position === position
        ? prev
        : { targetAgentId: id, position },
    );
  };

  const handleDragLeave = (id: string) => {
    setDropIndicator((prev) =>
      prev && prev.targetAgentId === id ? null : prev,
    );
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    const fromId =
      e.dataTransfer.getData(DRAG_MIME) ||
      e.dataTransfer.getData("text/plain") ||
      draggingId;
    setDraggingId(null);
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!fromId || fromId === targetId) {
      return;
    }
    const target = agents.find((a) => a.agent_id === targetId);
    if (!target) {
      return;
    }
    const position: DropPosition = indicator?.position ?? "before";
    reorderAgent(target.workspace_id, fromId, targetId, position);
  };

  return (
    <div className={styles.tabs}>
      {agents.map((agent, index) => {
        const indicator =
          dropIndicator && dropIndicator.targetAgentId === agent.agent_id
            ? dropIndicator.position
            : null;

        return (
          <AgentTab
            key={agent.agent_id}
            agent={agent}
            childCount={childCounts[agent.agent_id] ?? 0}
            dropIndicator={indicator}
            hasParent={Boolean(agent.parent_agent_id)}
            index={index}
            isActive={agent.agent_id === activeAgentId}
            isDragging={draggingId === agent.agent_id}
            onClose={onClose}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
