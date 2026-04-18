import type { AgentStatus } from "../../../lib/types";
import { useMemo } from "react";
import { Badge, Icons } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useConversation } from "../../../stores/conversationStore";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  activeAgentId: string | null;
  agents: AgentStatus[];
  onClose: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

function useTabLabel(agentId: string, fallback: string): string {
  const conv = useConversation(agentId);
  const messages = conv?.messages ?? [];
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || firstUser.textBlocks.length === 0) {
    return fallback;
  }
  const text = firstUser.textBlocks[0].trim();

  return text.length > 20 ? text.slice(0, 20) + "\u2026" : text;
}

function AgentTab({
  agent,
  index,
  isActive,
  childCount,
  hasParent,
  onSelect,
  onClose,
}: {
  agent: AgentStatus;
  childCount: number;
  hasParent: boolean;
  index: number;
  isActive: boolean;
  onClose: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const label = useTabLabel(agent.agent_id, `Agent ${index + 1}`);

  return (
    <div
      className={`${styles.tab} ${isActive ? styles.active : ""}`}
      onClick={() => onSelect(agent.agent_id)}
    >
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

  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of Object.values(allAgents)) {
      if (a.parent_agent_id) {
        counts[a.parent_agent_id] = (counts[a.parent_agent_id] ?? 0) + 1;
      }
    }

    return counts;
  }, [allAgents]);

  return (
    <div className={styles.tabs}>
      {agents.map((agent, index) => (
        <AgentTab
          key={agent.agent_id}
          agent={agent}
          childCount={childCounts[agent.agent_id] ?? 0}
          hasParent={Boolean(agent.parent_agent_id)}
          index={index}
          isActive={agent.agent_id === activeAgentId}
          onClose={onClose}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
