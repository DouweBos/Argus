import type { AgentStatus } from "../../../lib/types";
import { useConversation } from "../../../stores/conversationStore";
import { CloseIcon } from "../../shared/Icons";
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

  return (
    <div
      className={`${styles.tab} ${isActive ? styles.active : ""}`}
      onClick={() => onSelect(agent.agent_id)}
    >
      <span className={styles.label}>{label}</span>
      <button
        className={styles.closeBtn}
        title="Close agent"
        onClick={(e) => {
          e.stopPropagation();
          onClose(agent.agent_id);
        }}
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
          onClose={onClose}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
