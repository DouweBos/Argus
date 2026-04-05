import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useConversationStore } from "../stores/conversationStore";
import { useIpcEvent } from "./useIpcEvent";
import {
  startAgent as apiStartAgent,
  stopAgent as apiStopAgent,
  sendAgentMessage as apiSendAgentMessage,
} from "../lib/ipc";
import {
  startAgentListening,
  stopAgentListening,
} from "../lib/agentEventService";
import type { AgentStatus } from "../lib/types";

export function useWorkspaceAgents(
  workspaceId: null | string,
  options?: { autoStart?: boolean; workspaceReady?: boolean },
) {
  const { autoStart = true, workspaceReady = false } = options ?? {};

  // Targeted selectors — only re-render when these specific slices change
  const allAgents = useAgentStore((s) => s.agents);
  const activeAgentIds = useAgentStore((s) => s.activeAgentId);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const replaceAgent = useAgentStore((s) => s.replaceAgent);
  const setActiveAgentStore = useAgentStore((s) => s.setActiveAgent);
  const clearConversation = useConversationStore((s) => s.clearConversation);

  // Derive agents and activeAgent from state
  const agents = useMemo(
    () =>
      workspaceId
        ? Object.values(allAgents).filter((a) => a.workspace_id === workspaceId)
        : [],
    [allAgents, workspaceId],
  );

  const activeAgent = useMemo(() => {
    if (!workspaceId) return null;
    const agentId = activeAgentIds[workspaceId];
    if (!agentId) return null;
    return allAgents[agentId] ?? null;
  }, [allAgents, activeAgentIds, workspaceId]);

  const [isStarting, setIsStarting] = useState(false);
  const autoStartAttemptedRef = useRef<Set<string>>(new Set());

  // Track agent IDs to listen for status events
  const agentIdsRef = useRef<string[]>([]);
  agentIdsRef.current = agents.map((a) => a.agent_id);

  // Listen for backend status events for the active agent
  useIpcEvent<string>(
    activeAgent ? `agent:status:${activeAgent.agent_id}` : "",
    (payload) => {
      if (!activeAgent) return;
      const validStatuses = ["idle", "running", "stopped", "error"] as const;
      type StatusType = (typeof validStatuses)[number];
      const status: StatusType = validStatuses.includes(payload as StatusType)
        ? (payload as StatusType)
        : "error";
      updateAgent(activeAgent.agent_id, { status });
    },
  );

  // Placeholder effect for non-active agent IDs (reserved for future use)
  const nonActiveKey = agents
    .filter((a) => a.agent_id !== activeAgent?.agent_id)
    .map((a) => a.agent_id)
    .join(",");
  useEffect(() => {
    // Non-active agent status listeners would be set up here if needed
  }, [nonActiveKey]);

  const startNew = useCallback(
    async (
      model?: string,
      permissionMode?: string,
      resumeSessionId?: string,
    ) => {
      if (!workspaceId) return;
      if (isStarting) return;
      setIsStarting(true);
      try {
        const agentInfo: AgentStatus = await apiStartAgent(
          workspaceId,
          model,
          permissionMode,
          resumeSessionId,
        );
        startAgentListening(agentInfo.agent_id);
        addAgent({
          agent_id: agentInfo.agent_id,
          workspace_id: agentInfo.workspace_id,
          status: "running",
          permission_mode: permissionMode,
        });
        // Capabilities (commands, models, agents) are now discovered via the
        // initialize control_request sent by the backend on spawn. No
        // bootstrap user prompt needed.
      } finally {
        setIsStarting(false);
      }
    },
    [workspaceId, addAgent, isStarting],
  );

  // Auto-start agent when workspace is selected and ready
  useEffect(() => {
    if (
      !autoStart ||
      !workspaceId ||
      !workspaceReady ||
      agents.length > 0 ||
      isStarting
    )
      return;
    if (autoStartAttemptedRef.current.has(workspaceId)) return;
    autoStartAttemptedRef.current.add(workspaceId);
    startNew().catch(() => {
      autoStartAttemptedRef.current.delete(workspaceId);
    });
  }, [
    autoStart,
    workspaceId,
    workspaceReady,
    agents.length,
    isStarting,
    startNew,
  ]);

  // Allow retry when switching to a *different* workspace.
  // Only clear the previous ID so StrictMode unmount→remount cannot re-trigger auto-start.
  const prevWorkspaceId = useRef<null | string>(null);
  useEffect(() => {
    const prev = prevWorkspaceId.current;
    if (prev && prev !== workspaceId) {
      autoStartAttemptedRef.current.delete(prev);
    }
    prevWorkspaceId.current = workspaceId;
  }, [workspaceId]);

  const stopAgent = useCallback(
    async (agentId: string) => {
      stopAgentListening(agentId);
      try {
        await apiStopAgent(agentId);
      } catch (err) {
        console.error(`Failed to stop agent ${agentId}:`, err);
      }
      clearConversation(agentId);
      removeAgent(agentId);
    },
    [removeAgent, clearConversation],
  );

  const stopAll = useCallback(async () => {
    if (!workspaceId) return;
    const currentAgents = Object.values(useAgentStore.getState().agents).filter(
      (a) => a.workspace_id === workspaceId,
    );
    await Promise.allSettled(
      currentAgents.map((a) => apiStopAgent(a.agent_id)),
    );
    currentAgents.forEach((a) => {
      stopAgentListening(a.agent_id);
      clearConversation(a.agent_id);
      removeAgent(a.agent_id);
    });
  }, [workspaceId, removeAgent, clearConversation]);

  /** Stop the agent process and restart with new settings, resuming the same
   *  Claude CLI session so the conversation is preserved. */
  const restartAgent = useCallback(
    async (
      agentId: string,
      opts?: { model?: string; permissionMode?: string },
    ) => {
      if (!workspaceId) return;
      const conv = useConversationStore.getState().conversations[agentId];
      const sessionId = conv?.sessionId;
      const currentAgent = useAgentStore.getState().agents[agentId];
      const newPermissionMode =
        opts?.permissionMode !== undefined
          ? opts.permissionMode
          : currentAgent?.permission_mode;
      stopAgentListening(agentId);
      // Fire-and-forget — no need to wait for the old process to die before
      // spawning the new one (they have different agent IDs).
      apiStopAgent(agentId).catch(() => {});
      // Do NOT clear the conversation — we're resuming.
      const agentInfo: AgentStatus = await apiStartAgent(
        workspaceId,
        opts?.model,
        newPermissionMode,
        sessionId,
      );
      // Re-key conversation and agent store entry in-place (same tab slot).
      useConversationStore
        .getState()
        .migrateConversation(agentId, agentInfo.agent_id);
      replaceAgent(agentId, {
        agent_id: agentInfo.agent_id,
        workspace_id: agentInfo.workspace_id,
        status: "running",
        permission_mode: newPermissionMode,
      });
      startAgentListening(agentInfo.agent_id);
    },
    [workspaceId, replaceAgent],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeAgent) return;
      updateAgent(activeAgent.agent_id, { status: "running" });
      await apiSendAgentMessage(activeAgent.agent_id, message);
    },
    [activeAgent, updateAgent],
  );

  const setActive = useCallback(
    (agentId: string) => {
      if (!workspaceId) return;
      setActiveAgentStore(workspaceId, agentId);
    },
    [workspaceId, setActiveAgentStore],
  );

  return {
    agents,
    activeAgent,
    startNew,
    stopAgent,
    stopAll,
    restartAgent,
    sendMessage,
    setActive,
    isRunning:
      activeAgent?.status === "running" || activeAgent?.status === "idle",
    hasAgents: agents.length > 0,
    isStarting,
  };
}
