import type { ImageAttachment } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";
import { error as logError, info as logInfo } from "@argus/host/logger";
import { waitForSessionReady } from "../session/waitForReady";
import { capture } from "../telemetry/telemetry";

/**
 * Start an agent in a session that was just created and hand it `prompt`
 * once setup finishes. Runs on the host so the client that asked can go away
 * — a backgrounded phone or a reloaded window must not strand the prompt.
 */
export async function startAgentWhenReady(
  sessionId: string,
  prompt: string,
  options: {
    model?: string;
    permissionMode?: string;
    runnerId?: string;
    images?: ImageAttachment[];
    /** Set before the prompt goes out, so the first turn already runs at it. */
    effort?: string;
  } = {},
): Promise<void> {
  try {
    await waitForSessionReady(sessionId);
    // Lazy: agentService reaches back to the gateway through notifications.
    const { sendAgentMessage, setAgentEffort, startAgent } =
      await import("../agent/agentService");
    const agent = await startAgent(
      sessionId,
      options.model,
      options.permissionMode,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options.runnerId,
    );
    if (options.effort) {
      await setAgentEffort(agent.agent_id, options.effort).catch((e: unknown) =>
        logError(`Couldn't set effort on ${agent.agent_id}: ${String(e)}`),
      );
    }
    // Backend-initiated spawns are invisible to the UI without this.
    emitHostEvent("agent:started", {
      agent_id: agent.agent_id,
      session_id: agent.session_id,
      status: agent.status,
      parent_agent_id: agent.parent_agent_id,
      created_at: agent.created_at,
      initial_prompt: prompt,
      model: agent.model,
    });
    if (options.images?.length) {
      sendAgentMessage(agent.agent_id, prompt, options.images);
    } else {
      sendAgentMessage(agent.agent_id, prompt);
    }
    // The renderer only draws user bubbles for sends it made itself.
    emitHostEvent(`agent:remote-message:${agent.agent_id}`, {
      message: prompt,
      author: null,
    });
    logInfo(`Started agent ${agent.agent_id} with its prompt in ${sessionId}`);
    capture("session_prompt_dispatched", { success: true });
  } catch (e) {
    logError(`Couldn't start the prompted agent in ${sessionId}: ${String(e)}`);
    capture("session_prompt_dispatched", { success: false });
  }
}
