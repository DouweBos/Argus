import type { AgentStatus } from "../lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestStopAgent } from "../components/shared/ConfirmStopAgent/stopAgentRequest";
import {
  notifyMessageSent,
  startAgentListening,
  stopAgentListening,
} from "../lib/agentEventService";
import { startAgentInSession } from "../lib/agentLifecycle";
import {
  startAgent as apiStartAgent,
  stopAgent as apiStopAgent,
  submitAgentMessage,
} from "../lib/ipc";
import {
  getAgentState,
  removeAgent,
  replaceAgent,
  setActiveAgent,
  updateAgent,
  useActiveAgentIds,
  useAgentOrder,
  useAgentsRecord,
} from "../stores/agentStore";
import {
  clearConversation,
  getConversationState,
} from "../stores/conversationStore";
import { useIpcEvent } from "./useIpcEvent";

export function useSessionAgents(
  sessionId: string | null,
  options?: { autoStart?: boolean; sessionReady?: boolean },
) {
  const { autoStart = true, sessionReady = false } = options ?? {};

  const allAgents = useAgentsRecord();
  const activeAgentIds = useActiveAgentIds();
  const agentOrder = useAgentOrder(sessionId);

  const agents = useMemo(() => {
    if (!sessionId) {
      return [];
    }
    const sessionAgents = Object.values(allAgents).filter(
      (a) => a.session_id === sessionId,
    );
    const byId = new Map(sessionAgents.map((a) => [a.agent_id, a]));
    const ordered: AgentStatus[] = [];
    for (const id of agentOrder) {
      const agent = byId.get(id);
      if (agent) {
        ordered.push(agent);
        byId.delete(id);
      }
    }
    // Append any agents not yet in the order list (shouldn't normally happen).
    for (const agent of byId.values()) {
      ordered.push(agent);
    }

    return ordered;
  }, [allAgents, sessionId, agentOrder]);

  const activeAgent = useMemo(() => {
    if (!sessionId) {
      return null;
    }
    const agentId = activeAgentIds[sessionId];
    if (!agentId) {
      return null;
    }

    return allAgents[agentId] ?? null;
  }, [allAgents, activeAgentIds, sessionId]);

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
      const validStatuses = [
        "idle",
        "running",
        "requires_action",
        "stopped",
        "error",
      ] as const;
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
      runnerId?: string,
    ): Promise<string | null> => {
      if (!sessionId) {
        return null;
      }
      if (isStarting) {
        return null;
      }
      setIsStarting(true);
      try {
        const agentInfo = await startAgentInSession(sessionId, {
          focus: true,
          model,
          permissionMode,
          resumeSessionId,
          runnerId,
        });

        return agentInfo.agent_id;
      } finally {
        setIsStarting(false);
      }
    },
    [sessionId, isStarting],
  );

  useEffect(() => {
    if (
      !autoStart ||
      !sessionId ||
      !sessionReady ||
      agents.length > 0 ||
      isStarting
    ) {
      return;
    }
    if (autoStartAttemptedRef.current.has(sessionId)) {
      return;
    }
    autoStartAttemptedRef.current.add(sessionId);
    startNew().catch(() => {
      autoStartAttemptedRef.current.delete(sessionId);
    });
  }, [autoStart, sessionId, sessionReady, agents.length, isStarting, startNew]);

  const prevSessionId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSessionId.current;
    if (prev && prev !== sessionId) {
      autoStartAttemptedRef.current.delete(prev);
    }

    prevSessionId.current = sessionId;
  }, [sessionId]);

  const stopAgent = useCallback((agentId: string) => {
    requestStopAgent(agentId);
  }, []);

  const stopAll = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const currentAgents = Object.values(getAgentState().agents).filter(
      (a) => a.session_id === sessionId,
    );
    // The host saves each conversation as it stops.
    await Promise.allSettled(
      currentAgents.map((a) => apiStopAgent(a.agent_id)),
    );
    currentAgents.forEach((a) => {
      stopAgentListening(a.agent_id);
      clearConversation(a.agent_id);
      removeAgent(a.agent_id);
    });
  }, [sessionId]);

  const restartAgent = useCallback(
    async (
      agentId: string,
      opts?: { model?: string; permissionMode?: string },
    ) => {
      if (!sessionId) {
        return;
      }
      const conv = getConversationState().conversations[agentId];
      const claudeSessionId = conv?.sessionId;
      const currentAgent = getAgentState().agents[agentId];
      const newPermissionMode =
        opts?.permissionMode !== undefined
          ? opts.permissionMode
          : currentAgent?.permission_mode;
      // Preserve the agent's model on restart. The conversationStore captures
      // model from JSONL `system/init` events but those strip variant suffixes
      // like `[1m]`, so prefer the agentStore's spawn-time value first.
      const newModel =
        opts?.model !== undefined
          ? opts.model
          : (currentAgent?.model ?? conv?.model ?? undefined);
      stopAgentListening(agentId);
      // Stopping saves the history the resumed agent's conversation is seeded from.
      await apiStopAgent(agentId).catch(() => {});
      const agentInfo: AgentStatus = await apiStartAgent(
        sessionId,
        newModel ?? undefined,
        newPermissionMode,
        claudeSessionId,
      );
      clearConversation(agentId);
      replaceAgent(agentId, {
        agent_id: agentInfo.agent_id,
        session_id: agentInfo.session_id,
        status: agentInfo.status,
        permission_mode: newPermissionMode,
        model: agentInfo.model ?? newModel ?? null,
      });
      startAgentListening(agentInfo.agent_id);
    },
    [sessionId],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeAgent) {
        return;
      }
      const { queued } = await submitAgentMessage(
        activeAgent.agent_id,
        message,
      );
      if (!queued) {
        notifyMessageSent(activeAgent.agent_id);
      }
    },
    [activeAgent],
  );

  const setActive = useCallback(
    (agentId: string) => {
      if (!sessionId) {
        return;
      }
      setActiveAgent(sessionId, agentId);
    },
    [sessionId],
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
      activeAgent?.status === "running" ||
      activeAgent?.status === "idle" ||
      activeAgent?.status === "requires_action",
    hasAgents: agents.length > 0,
    isStarting,
  };
}
