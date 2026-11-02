import type { Session } from "./types";
import { IMAGES_ONLY_PROMPT } from "@argus/remote-protocol";
import { setLinkedProjects } from "../stores/conversationStore";
import { pushError } from "../stores/notificationsStore";
import {
  clearPendingPrompt,
  consumePendingPrompt,
  getSessionState,
  type PendingPrompt,
  subscribeSessionStore,
} from "../stores/sessionStore";
import { startAgentInSession, sendUserMessageToAgent } from "./agentLifecycle";
import { buildLinkedProjectsPreamble } from "./linkedProjectsPreamble";

/**
 * Pending prompts are captured at session-creation time. The backend creates
 * the session row immediately in `initializing` status and builds the worktree
 * in the background, so we can't start an agent right away — anything the
 * agent did would land in the wrong working directory. Instead, we watch
 * sessions and dispatch the stored prompt once the session reaches `ready`.
 *
 * If the session transitions to an error, we drop the prompt rather than
 * silently retry — the caller will surface the setup failure on its own.
 */

const dispatching = new Set<string>();

function isReady(status: Session["status"]): boolean {
  return status === "ready";
}

function isFailed(status: Session["status"]): boolean {
  return typeof status !== "string";
}

async function dispatchPrompt(
  session: Session,
  pending: PendingPrompt,
): Promise<void> {
  const { images, linkedProjects, model, permissionMode, prompt } = pending;
  try {
    const agentInfo = await startAgentInSession(session.id, {
      focus: false,
      model: model && model !== "default" ? model : undefined,
      permissionMode,
    });
    if (linkedProjects?.length) {
      setLinkedProjects(agentInfo.agent_id, linkedProjects);
    }
    const message = buildLinkedProjectsPreamble(
      linkedProjects ?? [],
      prompt || IMAGES_ONLY_PROMPT,
    );
    // The transcript (and the title made from it) shows what the user typed.
    await sendUserMessageToAgent(
      agentInfo.agent_id,
      message,
      images?.length ? images : undefined,
      message === prompt ? undefined : prompt,
    );
  } catch (err) {
    pushError(
      err instanceof Error ? err.message : String(err),
      "start_pending_agent",
    );
  }
}

export function initPendingSessionPrompts(): () => void {
  const tryDispatch = () => {
    const { sessions, pendingPromptBySessionId } = getSessionState();
    if (Object.keys(pendingPromptBySessionId).length === 0) {
      return;
    }

    for (const session of sessions) {
      const entry = pendingPromptBySessionId[session.id];
      if (entry === undefined) {
        continue;
      }
      if (dispatching.has(session.id)) {
        continue;
      }
      if (isFailed(session.status)) {
        clearPendingPrompt(session.id);
        continue;
      }
      if (!isReady(session.status)) {
        continue;
      }

      const consumed = consumePendingPrompt(session.id);
      if (consumed == null) {
        continue;
      }
      dispatching.add(session.id);
      dispatchPrompt(session, consumed).finally(() => {
        dispatching.delete(session.id);
      });
    }
  };

  // Run once in case sessions are already ready at init time.
  tryDispatch();

  const unsubscribe = subscribeSessionStore(tryDispatch);

  return unsubscribe;
}
