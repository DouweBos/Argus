import type { AgentStatus } from "../../../lib/types";
import { Icons } from "@argus/peacock";
import { setActiveAgent, setSplitPair } from "../../../stores/agentStore";
import { useConversation } from "../../../stores/conversationStore";
import { AgentChat } from "../AgentChat";
import { AgentSingleDropZone } from "../AgentChatDropZone";
import styles from "./SplitAgentPanes.module.css";

interface SplitAgentPanesProps {
  agents: AgentStatus[];
  left: AgentStatus;
  onRestart: (agentId: string) => void;
  right: AgentStatus;
  workspaceId: string;
}

function PaneHeader({
  agents,
  selectedId,
  label,
  disabledIds,
  onChange,
  onClose,
}: {
  agents: AgentStatus[];
  disabledIds: Set<string>;
  label: string;
  onChange: (agentId: string) => void;
  onClose?: () => void;
  selectedId: string;
}) {
  return (
    <div className={styles.paneHeader}>
      <span className={styles.paneLabel}>{label}</span>
      <select
        className={styles.paneSelect}
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
      >
        {agents.map((a, idx) => (
          <PaneOption
            key={a.agent_id}
            agent={a}
            index={idx}
            disabled={disabledIds.has(a.agent_id)}
          />
        ))}
      </select>
      {onClose && (
        <button
          className={styles.paneCloseBtn}
          title="Merge back into single tab"
          onClick={onClose}
        >
          <Icons.CloseIcon size={10} />
        </button>
      )}
    </div>
  );
}

function PaneOption({
  agent,
  index,
  disabled,
}: {
  agent: AgentStatus;
  disabled: boolean;
  index: number;
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
  left,
  right,
  workspaceId,
  onRestart,
}: SplitAgentPanesProps) {
  const leftDisabled = new Set<string>([right.agent_id]);
  const rightDisabled = new Set<string>([left.agent_id]);

  const closeSplit = () => {
    setSplitPair(workspaceId, null);
  };

  const changeLeft = (id: string) => {
    if (id === left.agent_id) {
      return;
    }
    if (id === right.agent_id) {
      // Swap
      setSplitPair(workspaceId, { left: id, right: left.agent_id });
      setActiveAgent(workspaceId, id);

      return;
    }
    setSplitPair(workspaceId, { left: id, right: right.agent_id });
    setActiveAgent(workspaceId, id);
  };

  const changeRight = (id: string) => {
    if (id === right.agent_id) {
      return;
    }
    if (id === left.agent_id) {
      setSplitPair(workspaceId, { left: right.agent_id, right: id });
      setActiveAgent(workspaceId, right.agent_id);

      return;
    }
    setSplitPair(workspaceId, { left: left.agent_id, right: id });
  };

  const dropOnLeft = (id: string) => {
    if (id === left.agent_id) {
      return;
    }
    changeLeft(id);
  };

  const dropOnRight = (id: string) => {
    if (id === right.agent_id) {
      return;
    }
    changeRight(id);
  };

  return (
    <div className={styles.panes}>
      <div className={styles.pane}>
        <PaneHeader
          agents={agents}
          selectedId={left.agent_id}
          label="Left"
          disabledIds={leftDisabled}
          onChange={changeLeft}
        />
        <AgentSingleDropZone
          ignoreIds={[left.agent_id]}
          label="Set as left pane"
          onDrop={dropOnLeft}
        >
          <div className={styles.paneBody}>
            <AgentChat
              agentId={left.agent_id}
              permissionMode={left.permission_mode}
              workspaceId={workspaceId}
              onRestart={() => onRestart(left.agent_id)}
            />
          </div>
        </AgentSingleDropZone>
      </div>
      <div className={styles.pane}>
        <PaneHeader
          agents={agents}
          selectedId={right.agent_id}
          label="Right"
          disabledIds={rightDisabled}
          onChange={changeRight}
          onClose={closeSplit}
        />
        <AgentSingleDropZone
          ignoreIds={[right.agent_id]}
          label="Set as right pane"
          onDrop={dropOnRight}
        >
          <div className={styles.paneBody}>
            <AgentChat
              agentId={right.agent_id}
              permissionMode={right.permission_mode}
              workspaceId={workspaceId}
              onRestart={() => onRestart(right.agent_id)}
            />
          </div>
        </AgentSingleDropZone>
      </div>
    </div>
  );
}
