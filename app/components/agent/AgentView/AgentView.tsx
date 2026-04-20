import { useCallback, useMemo } from "react";
import { Icons } from "@argus/peacock";
import { useSessionAgents } from "../../../hooks/useAgent";
import { useCloseIntent } from "../../../hooks/useCloseIntent";
import { isSessionReady } from "../../../lib/types";
import {
  setActiveAgent,
  setSplitPair,
  useSplitPair,
} from "../../../stores/agentStore";
import { useSessions } from "../../../stores/sessionStore";
import { AgentChat } from "../AgentChat";
import { AgentSplitDropZone } from "../AgentChatDropZone";
import { AgentTabBar } from "../AgentTabBar";
import { HomePanel } from "../HomePanel";
import { SplitAgentPanes } from "../SplitAgentPanes";
import styles from "./AgentView.module.css";

interface AgentViewProps {
  sessionId: string;
}

export function AgentView({ sessionId }: AgentViewProps) {
  const sessions = useSessions();
  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const { agents, activeAgent, startNew, stopAgent, restartAgent, setActive } =
    useSessionAgents(sessionId, {
      autoStart: false,
      sessionReady: session ? isSessionReady(session.status) : false,
    });

  const isHomeActive = !activeAgent;
  const splitPair = useSplitPair(sessionId);

  const openOnRight = useCallback(
    (agentId: string) => {
      if (!activeAgent) {
        setActive(agentId);

        return;
      }
      if (agentId === activeAgent.agent_id) {
        return;
      }
      setSplitPair(sessionId, { left: activeAgent.agent_id, right: agentId });
    },
    [activeAgent, sessionId, setActive],
  );

  const activeIsPaired =
    !!activeAgent &&
    !!splitPair &&
    (activeAgent.agent_id === splitPair.left ||
      activeAgent.agent_id === splitPair.right);

  // Resolve both pair members exist in this session's agents; otherwise the
  // pair is stale and we fall back to single-agent view.
  const resolvedPair = useMemo(() => {
    if (!splitPair) {
      return null;
    }
    const left = agents.find((a) => a.agent_id === splitPair.left);
    const right = agents.find((a) => a.agent_id === splitPair.right);
    if (!left || !right) {
      return null;
    }

    return { left, right };
  }, [agents, splitPair]);

  const showSplit = activeIsPaired && !!resolvedPair;

  // Cmd+W closes the active agent tab when one is open in this view.
  useCloseIntent(() => {
    if (!activeAgent) {
      return false;
    }
    stopAgent(activeAgent.agent_id);

    return true;
  });

  return (
    <>
      <div className={styles.agentBar}>
        <AgentTabBar
          activeAgentId={activeAgent?.agent_id ?? null}
          agents={agents}
          isHomeActive={isHomeActive}
          splitPair={splitPair}
          onClose={(agentId) => stopAgent(agentId)}
          onSelect={(agentId) => setActive(agentId)}
          onSelectHome={() => setActiveAgent(sessionId, null)}
          onUnpair={() => setSplitPair(sessionId, null)}
        />
        <button
          className={styles.agentBarAddBtn}
          title="Start new agent"
          onClick={() => startNew()}
        >
          <Icons.PlusIcon size={12} />
        </button>
        <div className={styles.agentBarSpacer} />
      </div>

      {!activeAgent && <HomePanel sessionId={sessionId} />}
      {activeAgent && showSplit && resolvedPair && (
        <SplitAgentPanes
          agents={agents}
          left={resolvedPair.left}
          right={resolvedPair.right}
          sessionId={sessionId}
          onRestart={(id) => restartAgent(id)}
        />
      )}
      {activeAgent && !showSplit && (
        <AgentSplitDropZone
          ignoreIds={[activeAgent.agent_id]}
          onDropLeft={(id) => setActive(id)}
          onDropRight={openOnRight}
        >
          <AgentChat
            agentId={activeAgent.agent_id}
            permissionMode={activeAgent.permission_mode}
            sessionId={sessionId}
            onRestart={() => restartAgent(activeAgent.agent_id)}
          />
        </AgentSplitDropZone>
      )}
    </>
  );
}
