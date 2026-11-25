/**
 * The Slack bot's seam, wired to the real host: sessions, agents, the
 * permission flow every client answers through, and telemetry.
 */

import type { SlackApi } from "./api";
import type { SlackBotDeps } from "./deps";
import type { SlackThread, SlackThreadStore } from "./threads";
import type { ImageAttachment } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { limitResetAt } from "../agent/limitResume";
import { getPublicUrl, isRemoteActive } from "../remote/remoteService";
import { startAgentWhenReady } from "../remote/startWhenReady";
import { createSession } from "../session/manager";
import { waitForSessionReady } from "../session/waitForReady";
import { teammateCache } from "../teammate/registry";
import { teammatesActive } from "../teammate/settings";
import { capture } from "../telemetry/telemetry";
import { loadSlackConfig, loadSlackIdentity, updateSlackConfig } from "./store";

export function sessionLinks(
  sessionId: string,
  agentId: string | null,
): { app: string; web: string | null } {
  const route = agentId
    ? `sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}`
    : `sessions/${encodeURIComponent(sessionId)}/agents`;
  const gateway = isRemoteActive() ? getPublicUrl() : null;
  const web = gateway
    ? `${gateway.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "")}/${route}`
    : null;

  return { app: `argus://${route}`, web };
}

function topLevelAgent(sessionId: string): string | null {
  for (const agent of appState.agents.values()) {
    if (agent.sessionId === sessionId && !agent.parentAgentId) {
      return agent.agentId;
    }
  }

  return null;
}

async function continueSession(
  thread: SlackThread,
  text: string,
  images: ImageAttachment[],
  author: string | null,
): Promise<{ agentId: string } | null> {
  if (thread.teammate) {
    return await continueTeammate(thread.teammate, text, images, author);
  }
  const sessionId = thread.sessionId;
  if (!sessionId || !appState.sessions.has(sessionId)) {
    return null;
  }
  let agentId =
    thread.agentId && appState.agents.has(thread.agentId)
      ? thread.agentId
      : topLevelAgent(sessionId);
  // Lazy: the agent stack reaches back to the gateway through notifications.
  if (!agentId) {
    await waitForSessionReady(sessionId);
    const { startAgent } = await import("../agent/agentService");
    const info = await startAgent(
      sessionId,
      undefined,
      undefined,
      thread.resumeRef ?? undefined,
    );
    emitHostEvent("agent:started", info);
    agentId = info.agent_id;
  }
  const { submitAgentMessage } = await import("../agent/conversation/actions");
  await submitAgentMessage(agentId, {
    text,
    author: author ?? undefined,
    images: images.length ? images : undefined,
  });

  return { agentId };
}

/** A teammate's thread: its agent, woken or resumed under the teammate's prompt. */
async function continueTeammate(
  ref: { teammateId: string; threadId: string },
  text: string,
  images: ImageAttachment[],
  author: string | null,
): Promise<{ agentId: string } | null> {
  const { openThread } = await import("../teammate/threads");
  let agentId: string;
  try {
    agentId = (await openThread(ref.teammateId, { threadId: ref.threadId }))
      .agent_id;
  } catch {
    return null;
  }
  const { submitAgentMessage } = await import("../agent/conversation/actions");
  await submitAgentMessage(agentId, {
    text,
    author: author ?? undefined,
    images: images.length ? images : undefined,
  });

  return { agentId };
}

function teammateByHandle(handle: string): { id: string; name: string } | null {
  if (!teammatesActive()) {
    return null;
  }
  const teammate = teammateCache().find((t) => t.handle === handle);

  return teammate ? { id: teammate.id, name: teammate.name } : null;
}

async function startTeammate(teammateId: string) {
  const { openThread } = await import("../teammate/threads");
  const opened = await openThread(teammateId, {
    fresh: true,
    surface: "slack",
  });

  return {
    sessionId: opened.session_id,
    agentId: opened.agent_id,
    threadId: opened.thread.id,
  };
}

export function hostDeps(
  teamId: string,
  api: SlackApi,
  threads: SlackThreadStore,
  respondToPermission: SlackBotDeps["respondToPermission"],
  onChannelMessage: SlackBotDeps["onChannelMessage"],
  onConfigChanged: () => void,
): SlackBotDeps {
  return {
    api,
    threads,
    config: () => loadSlackConfig(teamId),
    updateConfig: (fn) => {
      const next = updateSlackConfig(teamId, fn);
      onConfigChanged();

      return next;
    },
    identity: () => loadSlackIdentity(teamId),
    projects: () => [...appState.repoRoots],
    startSession: async (repoRoot, prompt, images) => {
      const session = await createSession(
        repoRoot,
        "",
        prompt.slice(0, 500) || "Request from Slack",
      );
      const agentReady = startAgentWhenReady(session.id, prompt, {
        images: images.length ? images : undefined,
      });

      return { sessionId: session.id, agentReady };
    },
    continueSession,
    teammateByHandle,
    startTeammate,
    resumeTeammate: async (threadId, author) => {
      const { threadRecord } = await import("../teammate/threads");
      if (!threadRecord(threadId)) {
        return null;
      }
      const { resumeThread } = await import("../teammate/recovery");
      const opened = await resumeThread(threadId, "slack", author ?? undefined);

      return { agentId: opened.agent_id };
    },
    limitResetAt: (agentId) => limitResetAt(agentId),
    pendingPrompt: (agentId, toolUseId) => {
      const prompt = appState.agentPendingPermissions
        .get(agentId)
        ?.get(toolUseId);

      return prompt
        ? { toolName: prompt.tool_name, toolInput: prompt.tool_input }
        : null;
    },
    respondToPermission,
    resumeRef: (agentId) => appState.agents.get(agentId)?.resumeRef ?? null,
    links: sessionLinks,
    telemetry: {
      messageHandled: (props) => capture("slack_message_handled", props),
      permissionAnswered: (decision) =>
        capture("slack_permission_answered", { decision }),
    },
    onChannelMessage,
  };
}
