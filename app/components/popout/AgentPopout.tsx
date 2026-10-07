import { useCallback, useEffect, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import {
  startAgentListening,
  stopAgentListening,
} from "../../lib/agentEventService";
import { closeAgentPopout, getSession, listAgents } from "../../lib/ipc";
import { addAgent, getAgent } from "../../stores/agentStore";
import { addSession, getSessionState } from "../../stores/sessionStore";
import { AgentChat } from "../agent/AgentChat";
import styles from "./AgentPopout.module.css";

interface AgentPopoutProps {
  agentId: string;
  sessionId: string;
  title?: string;
}

/**
 * Dedicated renderer for an agent that has been detached from the tab bar
 * into its own BrowserWindow. Seeds the session + agent stores from IPC,
 * follows the host's transcript, and hosts the standard `AgentChat`
 * component. A "Back to main window" button closes the popout; the main
 * window then re-shows the agent in its tab bar.
 */
export function AgentPopout({ agentId, sessionId, title }: AgentPopoutProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<string | undefined>();

  useEffect(() => {
    document.body.classList.add("argus-popout");

    return () => {
      document.body.classList.remove("argus-popout");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        // 1. Seed the session store so AgentChat / useSessions() can find it.
        const existingSessions = getSessionState().sessions;
        if (!existingSessions.some((s) => s.id === sessionId)) {
          const session = await getSession(sessionId);
          if (session) {
            addSession(session);
          }
        }

        // 2. Seed the agent into agentStore from the backend.
        if (!getAgent(agentId)) {
          const agents = await listAgents(sessionId);
          const match = agents.find((a) => a.agent_id === agentId);
          if (match) {
            addAgent(match);
          } else {
            throw new Error("Agent not found");
          }
        }

        const agent = getAgent(agentId);
        if (agent) {
          setPermissionMode(agent.permission_mode);
        }

        // 3. Follow the agent: its newest page from the host, then deltas.
        startAgentListening(agentId);

        if (!cancelled) {
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
      stopAgentListening(agentId);
    };
  }, [agentId, sessionId]);

  const handleBackToMain = useCallback(() => {
    closeAgentPopout(agentId).catch(() => {});
    // The window will close once the main process receives the close call.
  }, [agentId]);

  return (
    <div className={styles.root}>
      <div className={styles.titleBar}>
        <div className={styles.dragRegion} />
        <div className={styles.titleText}>{title || "Agent"}</div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleBackToMain}
          className={styles.backBtn}
          title="Return this agent to the main window"
        >
          <Icons.ArrowBackIcon size={12} />
          <span>Back to main window</span>
        </Button>
      </div>
      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}
        {!error && ready && (
          <AgentChat
            agentId={agentId}
            permissionMode={permissionMode}
            sessionId={sessionId}
          />
        )}
        {!error && !ready && (
          <div className={styles.loading}>Loading agent…</div>
        )}
      </div>
    </div>
  );
}
