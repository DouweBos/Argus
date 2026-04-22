import type { AgentStatus } from "../../../lib/types";
import { useMemo, useState } from "react";
import { StatusDot } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useConversations } from "../../../stores/conversationStore";
import { useSessions } from "../../../stores/sessionStore";
import { AgentPreviewDialog } from "../AgentPreviewDialog";
import styles from "./ChildAgentPills.module.css";

const MAX_TITLE = 28;

function statusTone(status: string): "error" | "idle" | "success" {
  if (status === "running") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }

  return "idle";
}

function titleFor(
  agent: AgentStatus,
  conversationTitle: string | undefined,
): string {
  const trimmed = conversationTitle?.trim();
  if (trimmed) {
    return trimmed.length > MAX_TITLE
      ? trimmed.slice(0, MAX_TITLE - 1) + "…"
      : trimmed;
  }

  return `Agent ${agent.agent_id.slice(0, 6)}`;
}

interface ChildAgentPillsProps {
  parentAgentId: string;
}

export function ChildAgentPills({ parentAgentId }: ChildAgentPillsProps) {
  const agents = useAgentsRecord();
  const sessions = useSessions();
  const conversations = useConversations();
  const [previewAgentId, setPreviewAgentId] = useState<string | null>(null);

  const children = useMemo(
    () =>
      Object.values(agents).filter((a) => a.parent_agent_id === parentAgentId),
    [agents, parentAgentId],
  );

  if (children.length === 0) {
    return null;
  }

  const previewAgent = previewAgentId ? (agents[previewAgentId] ?? null) : null;

  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>
          {children.length} child{children.length > 1 ? "ren" : ""}
        </span>
        {children.map((child) => {
          const session = sessions.find((s) => s.id === child.session_id);
          const sessionLabel =
            session?.display_name ??
            session?.branch ??
            child.session_id.slice(0, 8);
          const conv = conversations[child.agent_id];
          const title = titleFor(child, conv?.title);

          return (
            <button
              key={child.agent_id}
              className={styles.pill}
              title={`${title} · ${sessionLabel}`}
              onClick={() => setPreviewAgentId(child.agent_id)}
            >
              <StatusDot
                tone={statusTone(child.status)}
                pulse={child.status === "running"}
              />
              <span className={styles.title}>{title}</span>
              <span className={styles.session}>{sessionLabel}</span>
            </button>
          );
        })}
      </div>
      {previewAgent && (
        <AgentPreviewDialog
          agent={previewAgent}
          onClose={() => setPreviewAgentId(null)}
        />
      )}
    </>
  );
}
