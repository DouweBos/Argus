import type { AgentStatus } from "../../lib/types";
import { useConversationStore } from "../../stores/conversationStore";
import { CloseIcon } from "../shared/Icons";
import styles from "./AgentTabBar.module.css";

interface AgentTabBarProps {
  activeAgentId: null | string;
  agents: AgentStatus[];
  onClose: (agentId: string) => void;
  onSelect: (agentId: string) => void;
}

function useTabLabel(agentId: string, fallback: string): string {
  return useConversationStore((s) => {
    const messages = s.conversations[agentId]?.messages ?? [];
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser || firstUser.textBlocks.length === 0) return fallback;
    const text = firstUser.textBlocks[0].trim();
    return text.length > 20 ? text.slice(0, 20) + "\u2026" : text;
  });
}

function useHasPendingPermission(agentId: string): boolean {
  return useConversationStore((s) => {
    const messages = s.conversations[agentId]?.messages ?? [];
    return messages.some((m) => m.toolCalls.some((tc) => tc.pendingPermission));
  });
}

function AgentTab({
  agent,
  index,
  isActive,
  onSelect,
  onClose,
}: {
  agent: AgentStatus;
  index: number;
  isActive: boolean;
  onClose: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const label = useTabLabel(agent.agent_id, `Agent ${index + 1}`);
  const hasPending = useHasPendingPermission(agent.agent_id);
  const dotClass = hasPending ? "dot_pending" : `dot_${agent.status}`;
  return (
    <div
      className={`${styles.tab} ${isActive ? styles.active : ""}`}
      onClick={() => onSelect(agent.agent_id)}
    >
      <span className={`${styles.dot} ${styles[dotClass]}`} />
      <span className={styles.label}>{label}</span>
      <button
        className={styles.closeBtn}
        onClick={(e) => {
          e.stopPropagation();
          onClose(agent.agent_id);
        }}
        title="Close agent"
      >
        <CloseIcon size={10} />
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
  return (
    <div className={styles.tabs}>
      {agents.map((agent, index) => (
        <AgentTab
          key={agent.agent_id}
          agent={agent}
          index={index}
          isActive={agent.agent_id === activeAgentId}
          onSelect={onSelect}
          onClose={onClose}
        />
      ))}
    </div>
  );
}
