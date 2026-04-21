import { useCallback, useMemo, useRef, useState } from "react";
import {
  ContextMenu,
  type ContextMenuItem,
  Icons,
} from "@argus/peacock";
import { useSessionAgents } from "../../../hooks/useAgent";
import { useCloseIntent } from "../../../hooks/useCloseIntent";
import { isSessionReady } from "../../../lib/types";
import {
  removeRecentlyClosed,
  setActiveAgent,
  setSplitPair,
  useRecentlyClosedAgents,
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

  const openOnLeft = useCallback(
    (agentId: string) => {
      if (!activeAgent) {
        setActive(agentId);

        return;
      }
      if (agentId === activeAgent.agent_id) {
        return;
      }
      setSplitPair(sessionId, { left: agentId, right: activeAgent.agent_id });
      setActive(agentId);
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

  const recentlyClosed = useRecentlyClosedAgents(sessionId);
  const [recentMenuPos, setRecentMenuPos] = useState<
    { x: number; y: number } | null
  >(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  const openRecentMenu = useCallback(() => {
    if (!addBtnRef.current) {
      return;
    }
    const rect = addBtnRef.current.getBoundingClientRect();
    setRecentMenuPos({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const handleAddPointerDown = useCallback(() => {
    longPressFired.current = false;
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      openRecentMenu();
    }, 500);
  }, [openRecentMenu]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleAddClick = useCallback(() => {
    if (longPressFired.current) {
      longPressFired.current = false;

      return;
    }
    startNew();
  }, [startNew]);

  const recentMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (recentlyClosed.length === 0) {
      return [{ disabled: true, label: "No recently closed agents", onClick: () => {} }];
    }

    return recentlyClosed.map((entry) => ({
      label: entry.title,
      onClick: () => {
        removeRecentlyClosed(sessionId, entry.agentId);
        startNew(undefined, undefined, entry.claudeSessionId).catch(() => {});
      },
    }));
  }, [recentlyClosed, sessionId, startNew]);

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
          ref={addBtnRef}
          className={styles.agentBarAddBtn}
          title="Start new agent (long-press for recently closed)"
          onClick={handleAddClick}
          onPointerDown={handleAddPointerDown}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
        >
          <Icons.PlusIcon size={12} />
        </button>
        <div className={styles.agentBarSpacer} />
        {recentMenuPos && (
          <ContextMenu
            items={recentMenuItems}
            position={recentMenuPos}
            onClose={() => setRecentMenuPos(null)}
          />
        )}
      </div>

      {!activeAgent && <HomePanel sessionId={sessionId} />}
      {activeAgent && showSplit && resolvedPair && (
        <SplitAgentPanes
          left={resolvedPair.left}
          right={resolvedPair.right}
          sessionId={sessionId}
          onRestart={(id) => restartAgent(id)}
        />
      )}
      {activeAgent && !showSplit && (
        <AgentSplitDropZone
          ignoreIds={[activeAgent.agent_id]}
          onDropLeft={openOnLeft}
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
