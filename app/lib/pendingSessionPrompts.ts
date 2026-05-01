import type { ImageAttachment } from "./ipc";
import type { Session } from "./types";
import { setLinkedProjects } from "../stores/conversationStore";
import { pushError } from "../stores/notificationsStore";
import {
  clearPendingPrompt,
  consumePendingPrompt,
  getSessionState,
  setPendingPrompt,
  subscribeSessionStore,
} from "../stores/sessionStore";
import { maybeGenerateTitle } from "./agentEventService";
import { startAgentInSession, sendUserMessageToAgent } from "./agentLifecycle";
import { listen } from "./events";
import { buildLinkedProjectsPreamble } from "./linkedProjectsPreamble";

interface PendingPromptBroadcast {
  images?: ImageAttachment[];
  linkedProjects?: string[];
  model?: string;
  prompt: string;
  sessionId: string;
}

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
  prompt: string,
  images?: ImageAttachment[],
  model?: string,
  linkedProjects?: string[],
): Promise<void> {
  try {
    const agentInfo = await startAgentInSession(session.id, {
      focus: false,
      model: model && model !== "default" ? model : undefined,
    });
    maybeGenerateTitle(agentInfo.agent_id, prompt);
    if (linkedProjects?.length) {
      setLinkedProjects(agentInfo.agent_id, linkedProjects);
    }
    const message = buildLinkedProjectsPreamble(
      linkedProjects ?? [],
      prompt || "(see attached images)",
    );
    await sendUserMessageToAgent(
      agentInfo.agent_id,
      message,
      images?.length ? images : undefined,
      { assumeIdle: true },
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
      dispatchPrompt(
        session,
        consumed.prompt,
        consumed.images,
        consumed.model,
        consumed.linkedProjects,
      ).finally(() => {
        dispatching.delete(session.id);
      });
    }
  };

  // Run once in case sessions are already ready at init time.
  tryDispatch();

  // Listen for prompts pushed in from the global session launcher (which
  // lives in its own BrowserWindow and therefore has a separate sessionStore).
  // The backend rebroadcasts launcher submissions on `session:pending-prompt`
  // and we apply them to this window's store.
  const unlistenBroadcastPromise = listen<PendingPromptBroadcast>(
    "session:pending-prompt",
    ({ payload }) => {
      if (!payload?.sessionId) {
        return;
      }
      setPendingPrompt(payload.sessionId, payload.prompt, {
        images: payload.images,
        model: payload.model,
        linkedProjects: payload.linkedProjects,
      });
      // Trigger immediately in case the session is already ready.
      tryDispatch();
    },
  );

  const unsubscribe = subscribeSessionStore(tryDispatch);

  return () => {
    unsubscribe();
    unlistenBroadcastPromise.then((un) => un()).catch(() => {});
  };
}
