import type { ConversationMessage } from "../stores/conversationStore";
import {
  getConversationState,
  loadSavedMessages,
} from "../stores/conversationStore";
import { addSession, selectSession } from "../stores/sessionStore";
import { startAgentInSession } from "./agentLifecycle";
import { type ForkReplayOp, forkChatInSession, forkSession } from "./ipc";

/**
 * Count the number of real user turns in `messages[0..idx]` (inclusive).
 *
 * The backend uses this count to find the matching cutoff inside the Claude
 * Code JSONL — where user-role entries can be either "real" user messages or
 * tool_result continuations of a prior assistant turn.
 */
/**
 * Collect Edit/Write/MultiEdit tool calls from messages up to the fork point.
 *
 * These let the backend reconstruct uncommitted working-tree changes that
 * were made between the fork commit and the fork message: it resets the new
 * worktree to the fork commit, then replays these file operations against
 * it. Ops before the commit are naturally idempotent (or no-op) against the
 * already-committed state.
 */
function collectReplayOps(
  messages: ConversationMessage[],
  upToIdx: number,
): ForkReplayOp[] {
  const ops: ForkReplayOp[] = [];
  for (let i = 0; i <= upToIdx; i++) {
    const msg = messages[i];
    for (const tc of msg.toolCalls) {
      if (tc.isError) {
        continue;
      }
      const input = tc.input as Record<string, unknown>;
      if (tc.name === "Write") {
        const fp = input.file_path;
        const content = input.content;
        if (typeof fp === "string" && typeof content === "string") {
          ops.push({
            type: "write",
            filePath: fp,
            content,
            timestampMs: msg.timestamp,
          });
        }
      } else if (tc.name === "Edit") {
        const fp = input.file_path;
        const oldS = input.old_string;
        const newS = input.new_string;
        if (
          typeof fp === "string" &&
          typeof oldS === "string" &&
          typeof newS === "string"
        ) {
          ops.push({
            type: "edit",
            filePath: fp,
            oldString: oldS,
            newString: newS,
            replaceAll: input.replace_all === true,
            timestampMs: msg.timestamp,
          });
        }
      } else if (tc.name === "MultiEdit") {
        const fp = input.file_path;
        const rawEdits = input.edits;
        if (typeof fp === "string" && Array.isArray(rawEdits)) {
          const edits = rawEdits
            .map((e) => {
              const rec = e as Record<string, unknown>;

              return {
                oldString: rec.old_string,
                newString: rec.new_string,
                replaceAll: rec.replace_all === true,
              };
            })
            .filter(
              (
                e,
              ): e is {
                newString: string;
                oldString: string;
                replaceAll: boolean;
              } =>
                typeof e.oldString === "string" &&
                typeof e.newString === "string",
            );
          if (edits.length > 0) {
            ops.push({
              type: "multiEdit",
              filePath: fp,
              edits,
              timestampMs: msg.timestamp,
            });
          }
        }
      }
    }
  }

  return ops;
}

function countUserTurns(
  messages: ConversationMessage[],
  upToIdx: number,
): number {
  let n = 0;
  for (let i = 0; i <= upToIdx; i++) {
    if (messages[i].role === "user") {
      n += 1;
    }
  }

  return n;
}

/**
 * Fork a chat + its workspace from a given message.
 *
 * - Creates a new worktree pinned to the newest commit at or before the fork
 *   message's timestamp — no state from after the fork point is carried over.
 * - Copies the source Claude Code JSONL into the new worktree's Claude project
 *   dir, truncated at the fork turn with sessionId/cwd/branch rewritten, so
 *   the spawned agent resumes with a real, truncated conversation history.
 */
export async function forkChatFromMessage(
  sourceSessionId: string,
  agentId: string,
  forkMessageId: string,
  branch: string,
  description: string,
): Promise<void> {
  const conversation = getConversationState().conversations[agentId];
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  const idx = conversation.messages.findIndex((m) => m.id === forkMessageId);
  if (idx < 0) {
    throw new Error("Message not found");
  }
  const forkMessage = conversation.messages[idx];
  const backfill: ConversationMessage[] = conversation.messages
    .slice(0, idx + 1)
    .map((m) => ({ ...m }));
  const turnNumber = countUserTurns(conversation.messages, idx);
  const replayOps = collectReplayOps(conversation.messages, idx);

  const { session: newSession, claude_session_id: newClaudeSessionId } =
    await forkSession(
      sourceSessionId,
      branch,
      description,
      forkMessage.timestamp,
      turnNumber,
      conversation.sessionId ?? null,
      replayOps,
    );

  addSession(newSession);
  selectSession(newSession.id);

  const agent = await startAgentInSession(newSession.id, {
    focus: true,
    resumeSessionId: newClaudeSessionId ?? undefined,
  });

  // Seed the UI transcript with the truncated history. `resuming: true`
  // tells the store to drop replay events that Claude re-emits on --resume
  // (it replays the most recent turn). The model's own context is already
  // primed by the truncated JSONL, so we just need the UI to stay in sync.
  loadSavedMessages(
    agent.agent_id,
    backfill,
    conversation.model,
    newClaudeSessionId ?? undefined,
    newClaudeSessionId != null,
    conversation.title,
  );
}

/**
 * Fork a chat into a new agent within the *existing* session — keeps the
 * same worktree and creates a fresh agent with the conversation truncated
 * at the fork message.
 */
export async function forkChatIntoNewAgent(
  sessionId: string,
  agentId: string,
  forkMessageId: string,
): Promise<void> {
  const conversation = getConversationState().conversations[agentId];
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  if (!conversation.sessionId) {
    throw new Error("Conversation has no Claude session id to fork from");
  }
  const idx = conversation.messages.findIndex((m) => m.id === forkMessageId);
  if (idx < 0) {
    throw new Error("Message not found");
  }
  const forkMessage = conversation.messages[idx];
  const backfill: ConversationMessage[] = conversation.messages
    .slice(0, idx + 1)
    .map((m) => ({ ...m }));
  const turnNumber = countUserTurns(conversation.messages, idx);

  const { claude_session_id: newClaudeSessionId } = await forkChatInSession(
    sessionId,
    conversation.sessionId,
    forkMessage.timestamp,
    turnNumber,
  );

  const agent = await startAgentInSession(sessionId, {
    focus: true,
    resumeSessionId: newClaudeSessionId ?? undefined,
  });

  loadSavedMessages(
    agent.agent_id,
    backfill,
    conversation.model,
    newClaudeSessionId ?? undefined,
    newClaudeSessionId != null,
    conversation.title,
  );
}
