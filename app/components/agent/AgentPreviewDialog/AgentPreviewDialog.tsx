import type { AgentStatus } from "../../../lib/types";
import { useCallback } from "react";
import { Button, Dialog, DialogBody } from "@argus/peacock";
import { focusAgent } from "../../../lib/agentLifecycle";
import { useConversation } from "../../../stores/conversationStore";
import { useSessions } from "../../../stores/sessionStore";
import { AgentChat } from "../AgentChat";
import styles from "./AgentPreviewDialog.module.css";

interface AgentPreviewDialogProps {
  agent: AgentStatus;
  onClose: () => void;
}

export function AgentPreviewDialog({
  agent,
  onClose,
}: AgentPreviewDialogProps) {
  const sessions = useSessions();
  const session = sessions.find((s) => s.id === agent.session_id);
  const conversation = useConversation(agent.agent_id);

  const sessionLabel =
    session?.display_name ?? session?.branch ?? agent.session_id.slice(0, 8);
  const title =
    conversation?.title?.trim() ||
    conversation?.messages.find((m) => m.role === "user")?.textBlocks[0] ||
    `Agent ${agent.agent_id.slice(0, 6)}`;

  const handleGoTo = useCallback(() => {
    focusAgent(agent.session_id, agent.agent_id);
    onClose();
  }, [agent.agent_id, agent.session_id, onClose]);

  return (
    <Dialog
      size="full"
      onClose={onClose}
      title={
        <span className={styles.titleRow}>
          <span className={styles.titleText}>{title}</span>
          <span className={styles.sessionChip}>{sessionLabel}</span>
        </span>
      }
      titleId={`agent-preview-${agent.agent_id}`}
      titleExtra={
        <Button
          className={styles.gotoBtn}
          size="sm"
          variant="ghost"
          onClick={handleGoTo}
        >
          Open in session
        </Button>
      }
    >
      <DialogBody flush>
        <AgentChat
          agentId={agent.agent_id}
          permissionMode={agent.permission_mode}
          sessionId={agent.session_id}
          readOnly
        />
      </DialogBody>
    </Dialog>
  );
}
