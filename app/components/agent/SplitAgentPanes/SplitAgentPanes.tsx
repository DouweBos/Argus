import { useMemo } from "react";
import type { AgentStatus } from "../../../lib/types";
import { useConversation } from "../../../stores/conversationStore";
import { setSecondaryAgent } from "../../../stores/agentStore";
import { AgentChat } from "../AgentChat";
import styles from "./SplitAgentPanes.module.css";

interface SplitAgentPanesProps {
  agents: AgentStatus[];
  primary: AgentStatus;
  secondaryAgentId: string | null;
  workspaceId: string;
  onRestart: (agentId: string) => void;
}

function PaneHeader({
  agents,
  selectedId,
  label,
  disabledIds,
  onChange,
}: {
  agents: AgentStatus[];
  selectedId: string | null;
  label: string;
  disabledIds: Set<string>;
  onChange?: (agentId: string) => void;
}) {
  return (
    <div className={styles.paneHeader}>
      <span className={styles.paneLabel}>{label}</span>
      <select
        className={styles.paneSelect}
        value={selectedId ?? ""}
        disabled={!onChange}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {selectedId === null && <option value="">Select an agent…</option>}
        {agents.map((a, idx) => (
          <PaneOption
            key={a.agent_id}
            agent={a}
            index={idx}
            disabled={disabledIds.has(a.agent_id)}
          />
        ))}
      </select>
    </div>
  );
}

function PaneOption({
  agent,
  index,
  disabled,
}: {
  agent: AgentStatus;
  index: number;
  disabled: boolean;
}) {
  const conv = useConversation(agent.agent_id);
  const fallback = `Agent ${index + 1}`;
  const title = conv?.title?.trim() || fallback;

  return (
    <option value={agent.agent_id} disabled={disabled}>
      {title}
    </option>
  );
}

export function SplitAgentPanes({
  agents,
  primary,
  secondaryAgentId,
  workspaceId,
  onRestart,
}: SplitAgentPanesProps) {
  // Resolve the secondary agent. Default to the first non-primary in order.
  // If the stored secondary equals the primary (or is missing), fall back.
  const secondary = useMemo(() => {
    if (secondaryAgentId && secondaryAgentId !== primary.agent_id) {
      const match = agents.find((a) => a.agent_id === secondaryAgentId);
      if (match) {
        return match;
      }
    }
    const fallback = agents.find((a) => a.agent_id !== primary.agent_id);

    return fallback ?? null;
  }, [agents, primary.agent_id, secondaryAgentId]);

  const primaryDisabled = new Set<string>();
  if (secondary) {
    primaryDisabled.add(secondary.agent_id);
  }
  const secondaryDisabled = new Set<string>([primary.agent_id]);

  return (
    <div className={styles.panes}>
      <div className={styles.pane}>
        <PaneHeader
          agents={agents}
          selectedId={primary.agent_id}
          label="Left"
          disabledIds={primaryDisabled}
        />
        <div className={styles.paneBody}>
          <AgentChat
            agentId={primary.agent_id}
            permissionMode={primary.permission_mode}
            workspaceId={workspaceId}
            onRestart={() => onRestart(primary.agent_id)}
          />
        </div>
      </div>
      <div className={styles.pane}>
        <PaneHeader
          agents={agents}
          selectedId={secondary?.agent_id ?? null}
          label="Right"
          disabledIds={secondaryDisabled}
          onChange={(id) => setSecondaryAgent(workspaceId, id)}
        />
        <div className={styles.paneBody}>
          {secondary ? (
            <AgentChat
              agentId={secondary.agent_id}
              permissionMode={secondary.permission_mode}
              workspaceId={workspaceId}
              onRestart={() => onRestart(secondary.agent_id)}
            />
          ) : (
            <div className={styles.emptyPane}>
              Start another agent or pick one to view it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
