import type { AgentStatus } from "../../../lib/types";
import type { AgentStatus as PeacockAgentStatus } from "@argus/peacock";
import { useCallback, useMemo } from "react";
import { AgentRow, SectionPanel } from "@argus/peacock";
import { setActiveAgent, useAgentsRecord } from "../../../stores/agentStore";
import {
  firstUserText,
  useConversations,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "../homeLayout.module.css";

interface ActiveAgentsPanelProps {
  repoRoot: string | null;
  sessionId?: string;
}

function mapAgentStatus(status: AgentStatus["status"]): PeacockAgentStatus {
  switch (status) {
    case "running":
      return "running";
    case "error":
      return "error";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

function agentMetaLabel(status: AgentStatus["status"]): string {
  if (status === "running") {
    return "running";
  }
  if (status === "error") {
    return "blocked";
  }
  if (status === "requires_action") {
    return "needs input";
  }

  return "idle";
}

export function ActiveAgentsPanel({
  repoRoot,
  sessionId,
}: ActiveAgentsPanelProps) {
  const agentsRecord = useAgentsRecord();
  const conversations = useConversations();
  const sessions = useSessions();

  const scopedSessions = useMemo(() => {
    if (sessionId) {
      const session = sessions.find((w) => w.id === sessionId);

      return session ? [session] : [];
    }
    if (repoRoot) {
      return sessions.filter((w) => w.repo_root === repoRoot);
    }

    return [];
  }, [sessions, repoRoot, sessionId]);

  const scopedSessionIds = useMemo(
    () => new Set(scopedSessions.map((w) => w.id)),
    [scopedSessions],
  );

  const activeAgents = useMemo(() => {
    return Object.values(agentsRecord)
      .filter(
        (a) => scopedSessionIds.has(a.session_id) && a.status !== "stopped",
      )
      .map((a) => {
        const ws = scopedSessions.find((w) => w.id === a.session_id);
        const conv = conversations[a.agent_id];
        const convTitle = conv?.title?.trim();
        const firstText = firstUserText(conv)?.trim();
        const displayName =
          convTitle || firstText || ws?.display_name || ws?.branch || "Agent";
        const branchLabel = ws?.display_name ?? ws?.branch ?? "";

        return {
          agentId: a.agent_id,
          sessionId: a.session_id,
          displayName,
          branchLabel,
          model: a.model ?? null,
          status: a.status,
          createdAt: a.created_at ?? 0,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [agentsRecord, scopedSessionIds, scopedSessions, conversations]);

  const handleOpenAgent = useCallback(
    (targetSessionId: string, agentId: string) => {
      selectSession(targetSessionId);
      setActiveAgent(targetSessionId, agentId);
      requestAnimationFrame(() => setActiveCenterView("agents"));
    },
    [],
  );

  if (activeAgents.length === 0) {
    return null;
  }

  return (
    <SectionPanel
      title="Active agents"
      meta={`${activeAgents.length} ${activeAgents.length === 1 ? "agent" : "agents"}`}
    >
      <div className={styles.rowList}>
        {activeAgents.map((a) => (
          <AgentRow
            key={a.agentId}
            name={a.displayName}
            project={a.branchLabel || undefined}
            status={mapAgentStatus(a.status)}
            model={a.model ?? undefined}
            meta={agentMetaLabel(a.status)}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => handleOpenAgent(a.sessionId, a.agentId)}
          />
        ))}
      </div>
    </SectionPanel>
  );
}
