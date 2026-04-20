import { Icons } from "@argus/peacock";
import { useCallback, useMemo } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { useCloseIntent } from "../../../hooks/useCloseIntent";
import { isWorkspaceReady } from "../../../lib/types";
import {
  setActiveAgent,
  setSplitPair,
  useSplitPair,
} from "../../../stores/agentStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { AgentChat } from "../AgentChat";
import { AgentSplitDropZone } from "../AgentChatDropZone";
import { AgentTabBar } from "../AgentTabBar";
import { HomePanel } from "../HomePanel";
import { SplitAgentPanes } from "../SplitAgentPanes";
import styles from "./AgentView.module.css";

interface AgentViewProps {
  workspaceId: string;
}

export function AgentView({ workspaceId }: AgentViewProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const { agents, activeAgent, startNew, stopAgent, restartAgent, setActive } =
    useWorkspaceAgents(workspaceId, {
      autoStart: false,
      workspaceReady: workspace ? isWorkspaceReady(workspace.status) : false,
    });

  const isHomeActive = !activeAgent;
  const splitPair = useSplitPair(workspaceId);

  const openOnRight = useCallback(
    (agentId: string) => {
      if (!activeAgent) {
        setActive(agentId);

        return;
      }
      if (agentId === activeAgent.agent_id) {
        return;
      }
      setSplitPair(workspaceId, { left: activeAgent.agent_id, right: agentId });
    },
    [activeAgent, workspaceId, setActive],
  );

  const activeIsPaired =
    !!activeAgent &&
    !!splitPair &&
    (activeAgent.agent_id === splitPair.left ||
      activeAgent.agent_id === splitPair.right);

  // Resolve both pair members exist in this workspace's agents; otherwise the
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
          onSelectHome={() => setActiveAgent(workspaceId, null)}
          onUnpair={() => setSplitPair(workspaceId, null)}
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

      {!activeAgent && <HomePanel workspaceId={workspaceId} />}
      {activeAgent && showSplit && resolvedPair && (
        <SplitAgentPanes
          agents={agents}
          left={resolvedPair.left}
          right={resolvedPair.right}
          workspaceId={workspaceId}
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
            workspaceId={workspaceId}
            onRestart={() => restartAgent(activeAgent.agent_id)}
          />
        </AgentSplitDropZone>
      )}
    </>
  );
}
