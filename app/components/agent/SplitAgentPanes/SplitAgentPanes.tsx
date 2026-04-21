import type { AgentStatus } from "../../../lib/types";
import { setActiveAgent, setSplitPair } from "../../../stores/agentStore";
import { AgentChat } from "../AgentChat";
import { AgentSingleDropZone } from "../AgentChatDropZone";
import styles from "./SplitAgentPanes.module.css";

interface SplitAgentPanesProps {
  left: AgentStatus;
  onRestart: (agentId: string) => void;
  right: AgentStatus;
  sessionId: string;
}

export function SplitAgentPanes({
  left,
  right,
  sessionId,
  onRestart,
}: SplitAgentPanesProps) {
  const dropOnLeft = (id: string) => {
    if (id === left.agent_id) {
      return;
    }
    if (id === right.agent_id) {
      setSplitPair(sessionId, { left: id, right: left.agent_id });
      setActiveAgent(sessionId, id);

      return;
    }
    setSplitPair(sessionId, { left: id, right: right.agent_id });
    setActiveAgent(sessionId, id);
  };

  const dropOnRight = (id: string) => {
    if (id === right.agent_id) {
      return;
    }
    if (id === left.agent_id) {
      setSplitPair(sessionId, { left: right.agent_id, right: id });
      setActiveAgent(sessionId, right.agent_id);

      return;
    }
    setSplitPair(sessionId, { left: left.agent_id, right: id });
  };

  return (
    <div className={styles.panes}>
      <div className={styles.pane}>
        <AgentSingleDropZone
          ignoreIds={[left.agent_id]}
          label="Set as left pane"
          onDrop={dropOnLeft}
        >
          <div className={styles.paneBody}>
            <AgentChat
              agentId={left.agent_id}
              permissionMode={left.permission_mode}
              sessionId={sessionId}
              onRestart={() => onRestart(left.agent_id)}
            />
          </div>
        </AgentSingleDropZone>
      </div>
      <div className={styles.pane}>
        <AgentSingleDropZone
          ignoreIds={[right.agent_id]}
          label="Set as right pane"
          onDrop={dropOnRight}
        >
          <div className={styles.paneBody}>
            <AgentChat
              agentId={right.agent_id}
              permissionMode={right.permission_mode}
              sessionId={sessionId}
              onRestart={() => onRestart(right.agent_id)}
            />
          </div>
        </AgentSingleDropZone>
      </div>
    </div>
  );
}
