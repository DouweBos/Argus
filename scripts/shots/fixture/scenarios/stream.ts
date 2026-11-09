import type { FixtureEvent, FixtureResolver } from "../types";
import type { LlmStreamEvent } from "@argus/host/services/agent/conversation/types";

export const AGENT_ID = "agt_ses_offline";
export const MODEL = "claude-opus-5-5";

const USAGE = { input_tokens: 18_432, output_tokens: 612 };

/**
 * `agent:event:<id>` carries stream-json as a string — the same payload the
 * Claude Code CLI writes — so the transcript is built by the real code path
 * rather than by poking the store.
 */
export function ev(payload: LlmStreamEvent): FixtureEvent {
  return {
    channel: `agent:event:${AGENT_ID}`,
    payload: JSON.stringify(payload),
  };
}

/** What you type into the composer: the host's user turn. */
export function prompt(message: string): FixtureEvent {
  return { channel: `agent:user-message:${AGENT_ID}`, payload: { message } };
}

export function say(text: string): FixtureEvent {
  return ev({
    type: "assistant",
    message: { model: MODEL, usage: USAGE, content: [{ type: "text", text }] },
  });
}

export function tool(
  id: string,
  name: string,
  input: Record<string, unknown>,
  text?: string,
): FixtureEvent {
  return ev({
    type: "assistant",
    message: {
      model: MODEL,
      usage: USAGE,
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        { type: "tool_use", id, name, input },
      ],
    },
  });
}

export function toolResult(id: string, content: string): FixtureEvent {
  return ev({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
  });
}

export function finished(durationMs: number, costUsd: number): FixtureEvent {
  return ev({
    type: "result",
    subtype: "success",
    duration_ms: durationMs,
    total_cost_usd: costUsd,
    usage: USAGE,
  });
}

/**
 * A live agent announces these over `agent:capabilities`. Without them the
 * chat header cannot resolve a context window and the panel throws.
 */
export const CAPABILITIES = {
  agents: [],
  commands: [],
  models: [
    {
      description: "Most capable model",
      displayName: "Opus 5.5",
      value: MODEL,
    },
    {
      description: "Fast and capable",
      displayName: "Sonnet 5.5",
      value: "claude-sonnet-5-5",
    },
  ],
};

const SIMULATOR = {
  udid: "5C1A9F3E-AURORA-17PRO",
  name: "iPhone 17 Pro",
  runtime: "iOS 26.0",
  booted: true,
};

/**
 * The session's side panel open on its simulator, as the host hands the Mac
 * its picks on connect. The picture is the scenario's `deviceScreen`.
 */
export function devicePanel(sessionId: string): Record<string, unknown> {
  const uiState: Record<string, unknown> = {
    "runtime.platform": "ios",
    "runtime.ios_by_session": { [sessionId]: SIMULATOR.udid },
    "mac.side_panels": {
      [sessionId]: {
        open: true,
        tabs: [{ kind: "device" }],
        selected: "device",
        width: 470,
      },
    },
  };

  return {
    list_simulators: [SIMULATOR],
    ui_state_get: ((args) =>
      String(args.key) in uiState
        ? JSON.stringify(uiState[String(args.key)])
        : null) as FixtureResolver,
  };
}
