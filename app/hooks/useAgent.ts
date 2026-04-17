import type { AgentStatus } from "../lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  notifyMessageSent,
  saveAgentConversation,
  startAgentListening,
  stopAgentById,
  stopAgentListening,
} from "../lib/agentEventService";
import {
  sendAgentMessage as apiSendAgentMessage,
  startAgent as apiStartAgent,
  stopAgent as apiStopAgent,
} from "../lib/ipc";
import {
  addAgent,
  getAgentState,
  removeAgent,
  replaceAgent,
  setActiveAgent,
  updateAgent,
  useActiveAgentIds,
  useAgentsRecord,
} from "../stores/agentStore";
import {
  clearConversation,
  getConversationState,
  migrateConversation,
} from "../stores/conversationStore";
import { useIpcEvent } from "./useIpcEvent";

export function useWorkspaceAgents(
  workspaceId: string | null,
  options?: { autoStart?: boolean; workspaceReady?: boolean },
) {
  const { autoStart = true, workspaceReady = false } = options ?? {};

  const allAgents = useAgentsRecord();
  const activeAgentIds = useActiveAgentIds();

  const agents = useMemo(
    () =>
      workspaceId
        ? Object.values(allAgents).filter((a) => a.workspace_id === workspaceId)
        : [],
    [allAgents, workspaceId],
  );

  const activeAgent = useMemo(() => {
    if (!workspaceId) {
      return null;
    }
    const agentId = activeAgentIds[workspaceId];
    if (!agentId) {
      return null;
    }

    return allAgents[agentId] ?? null;
  }, [allAgents, activeAgentIds, workspaceId]);

  const [isStarting, setIsStarting] = useState(false);
  const autoStartAttemptedRef = useRef<Set<string>>(new Set());

  const agentIdsRef = useRef<string[]>([]);
  agentIdsRef.current = agents.map((a) => a.agent_id);

  useIpcEvent<string>(
    activeAgent ? `agent:status:${activeAgent.agent_id}` : "",
    (payload) => {
      if (!activeAgent) {
        return;
      }
      const validStatuses = ["idle", "running", "stopped", "error"] as const;
      type StatusType = (typeof validStatuses)[number];
      const status: StatusType = validStatuses.includes(payload as StatusType)
        ? (payload as StatusType)
        : "error";
      updateAgent(activeAgent.agent_id, { status });
    },
  );

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
    ): Promise<string | null> => {
      if (!workspaceId) {
        return null;
      }
      if (isStarting) {
        return null;
      }
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

        return agentInfo.agent_id;
      } finally {
        setIsStarting(false);
      }
    },
    [workspaceId, isStarting],
  );

  useEffect(() => {
    if (
      !autoStart ||
      !workspaceId ||
      !workspaceReady ||
      agents.length > 0 ||
      isStarting
    ) {
      return;
    }
    if (autoStartAttemptedRef.current.has(workspaceId)) {
      return;
    }
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

  const prevWorkspaceId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevWorkspaceId.current;
    if (prev && prev !== workspaceId) {
      autoStartAttemptedRef.current.delete(prev);
    }

    prevWorkspaceId.current = workspaceId;
  }, [workspaceId]);

  const stopAgent = useCallback(async (agentId: string) => {
    await stopAgentById(agentId);
  }, []);

  const stopAll = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    const currentAgents = Object.values(getAgentState().agents).filter(
      (a) => a.workspace_id === workspaceId,
    );
    // Save all conversations before cleanup
    currentAgents.forEach((a) => saveAgentConversation(a.agent_id));
    await Promise.allSettled(
      currentAgents.map((a) => apiStopAgent(a.agent_id)),
    );
    currentAgents.forEach((a) => {
      stopAgentListening(a.agent_id);
      clearConversation(a.agent_id);
      removeAgent(a.agent_id);
    });
  }, [workspaceId]);

  const restartAgent = useCallback(
    async (
      agentId: string,
      opts?: { model?: string; permissionMode?: string },
    ) => {
      if (!workspaceId) {
        return;
      }
      const conv = getConversationState().conversations[agentId];
      const sessionId = conv?.sessionId;
      const currentAgent = getAgentState().agents[agentId];
      const newPermissionMode =
        opts?.permissionMode !== undefined
          ? opts.permissionMode
          : currentAgent?.permission_mode;
      stopAgentListening(agentId);
      apiStopAgent(agentId).catch(() => {});
      const agentInfo: AgentStatus = await apiStartAgent(
        workspaceId,
        opts?.model,
        newPermissionMode,
        sessionId,
      );
      migrateConversation(agentId, agentInfo.agent_id);
      replaceAgent(agentId, {
        agent_id: agentInfo.agent_id,
        workspace_id: agentInfo.workspace_id,
        status: "running",
        permission_mode: newPermissionMode,
      });
      startAgentListening(agentInfo.agent_id);
    },
    [workspaceId],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeAgent) {
        return;
      }
      notifyMessageSent(activeAgent.agent_id);
      updateAgent(activeAgent.agent_id, { status: "running" });
      await apiSendAgentMessage(activeAgent.agent_id, message);
    },
    [activeAgent],
  );

  const setActive = useCallback(
    (agentId: string) => {
      if (!workspaceId) {
        return;
      }
      setActiveAgent(workspaceId, agentId);
    },
    [workspaceId],
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
