import {
  checkClaudeCli,
  claimPrewarmAgent,
  discardPrewarmAgent,
  interruptAgent,
  launchAgent,
  listAgents,
  prewarmAgent,
  respondToPermission,
  restoreAgentAtTurn,
  sendAgentMessage,
  setAgentEffort,
  setAgentModel,
  setAgentPermissionMode,
  stopAgent,
} from "../services/agent/agentService";
import {
  deleteHistoryEntry,
  loadConversation,
  loadHistoryIndex,
  saveConversation,
  searchChatHistory,
} from "../services/agent/chatHistory";
import {
  createCheckpoint,
  deleteCheckpoint,
  restoreCheckpoint,
} from "../services/agent/checkpoints";
import {
  agentForkPoint,
  clearConversation,
  dismissConversationList,
  rewindAgent,
  seedForkedConversation,
  setConversationTitle,
  submitAgentMessage,
} from "../services/agent/conversation/actions";
import {
  isLive,
  livePage,
  readConversation,
} from "../services/agent/conversation/live";
import {
  dismissLimitResume,
  limitResumeAt,
} from "../services/agent/limitResume";
import {
  clearQueue,
  dequeueMessage,
  enqueueMessage,
  listQueue,
  removeQueuedMessage,
  updateQueuedMessage,
} from "../services/agent/messageQueue";
import { defineTypedCommand } from "../services/command/registry";
import { generateChatTitle } from "../services/llm/titleGenerator";
import { showAgentNotification } from "../services/notifications/osNotification";

export function registerAgentCommands(): void {
  defineTypedCommand("check_claude_cli", () => checkClaudeCli());
  defineTypedCommand("start_agent", async ({ seedFrom, ...p }) => {
    const agent = await launchAgent(p);
    if (seedFrom) {
      seedForkedConversation(agent.agent_id, seedFrom, p.resumeSessionId);
    }

    return agent;
  });
  defineTypedCommand("stop_agent", (p) => stopAgent(p.agentId));
  defineTypedCommand("restore_agent_at_turn", (p) => restoreAgentAtTurn(p));
  defineTypedCommand("interrupt_agent", (p) => interruptAgent(p.agentId));
  defineTypedCommand("send_agent_message", (p) =>
    sendAgentMessage(p.agentId, p.message, p.images ?? undefined),
  );
  defineTypedCommand("list_agents", (p) => listAgents(p.sessionId));
  defineTypedCommand("respond_to_permission", (p) =>
    respondToPermission(
      p.agentId,
      p.toolUseId,
      p.decision,
      p.allowRule ?? undefined,
      p.allowAll ?? undefined,
      p.denyMessage ?? undefined,
    ),
  );
  defineTypedCommand("set_agent_model", (p) =>
    setAgentModel(p.agentId, p.model),
  );
  defineTypedCommand("set_agent_permission_mode", (p) =>
    setAgentPermissionMode(p.agentId, p.mode),
  );
  defineTypedCommand("set_agent_effort", (p) =>
    setAgentEffort(p.agentId, p.level ?? null),
  );
  defineTypedCommand("prewarm_agent", (p) => prewarmAgent(p.sessionId));
  defineTypedCommand("claim_prewarm_agent", (p) =>
    claimPrewarmAgent(p.agentId, {
      model: p.model,
      permissionMode: p.permissionMode,
    }),
  );
  defineTypedCommand("discard_prewarm_agent", (p) =>
    discardPrewarmAgent(p.agentId),
  );

  defineTypedCommand("create_checkpoint", (p) => createCheckpoint(p.sessionId));
  defineTypedCommand("restore_checkpoint", (p) =>
    restoreCheckpoint(p.sessionId, p.checkpointId),
  );
  defineTypedCommand("delete_checkpoint", (p) =>
    deleteCheckpoint(p.sessionId, p.checkpointId),
  );

  defineTypedCommand("save_chat_history", (p) => {
    // An older desktop still saves the chats it folds; the host's own record
    // of a live agent is the one that counts.
    if (p.conversation.agentId && isLive(p.conversation.agentId)) {
      return;
    }
    saveConversation(p.repoRoot, p.conversation);
  });
  defineTypedCommand("list_chat_history", (p) => loadHistoryIndex(p.repoRoot));
  defineTypedCommand("search_chat_history", (p) =>
    searchChatHistory(p.repoRoot, p.query),
  );
  defineTypedCommand("load_chat_history", (p) =>
    loadConversation(p.repoRoot, p.historyId),
  );
  defineTypedCommand("delete_chat_history", (p) =>
    deleteHistoryEntry(p.repoRoot, p.historyId),
  );
  defineTypedCommand("generate_session_title", (p) =>
    generateChatTitle(p.firstMessage),
  );

  defineTypedCommand("get_agent_limit_resume", (p) => limitResumeAt(p.agentId));
  defineTypedCommand("dismiss_agent_limit_resume", (p) =>
    dismissLimitResume(p.agentId),
  );
  defineTypedCommand("list_queued_messages", (p) => listQueue(p.agentId));
  defineTypedCommand("queue_message", (p) =>
    enqueueMessage(p.agentId, {
      text: p.text,
      displayText: p.displayText,
      images: p.images,
      author: p.author,
    }),
  );
  defineTypedCommand("remove_queued_message", (p) =>
    removeQueuedMessage(p.agentId, p.id),
  );
  defineTypedCommand("update_queued_message", (p) =>
    updateQueuedMessage(p.agentId, p.id, p.text),
  );
  defineTypedCommand("clear_queued_messages", (p) => clearQueue(p.agentId));
  defineTypedCommand(
    "dequeue_message",
    (p) => dequeueMessage(p.agentId) ?? null,
  );

  // Older desktops publish what they fold; the host folds it itself now.
  defineTypedCommand("publish_agent_snapshot", () => undefined);
  defineTypedCommand("get_agent_snapshot", (p) => {
    const live = readConversation(p.agentId);

    return live ? JSON.stringify(live) : null;
  });
  defineTypedCommand("submit_agent_message", ({ agentId, ...message }) =>
    submitAgentMessage(agentId, message),
  );
  defineTypedCommand("rewind_agent", ({ agentId, messageId, ...options }) =>
    rewindAgent(agentId, messageId, options),
  );
  defineTypedCommand("agent_fork_point", (p) =>
    agentForkPoint(p.agentId, p.messageId),
  );
  defineTypedCommand("set_agent_title", (p) =>
    setConversationTitle(p.agentId, p.title),
  );
  defineTypedCommand("dismiss_agent_list", (p) =>
    dismissConversationList(p.agentId, p.list),
  );
  defineTypedCommand("clear_agent_transcript", (p) =>
    clearConversation(p.agentId),
  );
  defineTypedCommand("get_agent_transcript", (p) =>
    livePage(p.agentId, { before: p.before, limit: p.limit }),
  );
  defineTypedCommand("notify_agent", (p) => {
    showAgentNotification(p.payload, { showLocal: p.showLocal });
  });
}
