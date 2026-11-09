import type { FixtureEvent, FixtureResolver, FixtureScenario } from "../types";
import type { LlmStreamEvent } from "@argus/host/services/agent/conversation/types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE } from "./aurora";

export const AGENT_ID = "agt_ses_offline";

/**
 * `agent:event:<id>` carries stream-json as a string — the same payload the
 * Claude Code CLI writes — so the transcript is built by the real code path
 * rather than by poking the store.
 */
export function streamed(events: LlmStreamEvent[]): FixtureEvent[] {
  return events.map((payload, index) => ({
    channel: `agent:event:${AGENT_ID}`,
    payload: JSON.stringify(payload),
    // Staggered so the store sees a conversation build up, the way it would
    // from a live run, rather than one batch the renderer coalesces.
    delayMs: 400 + index * 30,
  }));
}

const USAGE = { input_tokens: 18_432, output_tokens: 612 };

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
      displayName: "Opus 5",
      value: "claude-opus-5",
    },
    {
      description: "Fast and capable",
      displayName: "Sonnet 5",
      value: "claude-sonnet-5",
    },
  ],
};

export const TRANSCRIPT: LlmStreamEvent[] = [
  {
    type: "system",
    subtype: "init",
    model: "claude-opus-5",
    session_id: "conv_offline",
    tools: [
      { name: "Read" },
      { name: "Edit" },
      { name: "Bash" },
      { name: "Grep" },
    ],
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: "Downloads currently stream straight from the network layer, so airplane mode drops them. I'll find where the episode fetch resolves and add a cache read in front of it.",
        },
        {
          type: "tool_use",
          id: "tu_1",
          name: "Grep",
          input: {
            pattern: "func fetchEpisode",
            output_mode: "files_with_matches",
          },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          content:
            "src/player/EpisodeLoader.swift\nsrc/net/EpisodeClient.swift",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      usage: USAGE,
      content: [
        {
          type: "tool_use",
          id: "tu_2",
          name: "Read",
          input: { file_path: "src/player/EpisodeLoader.swift", limit: 60 },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_2",
          content:
            "  1\timport Foundation\n  2\t\n  3\tactor EpisodeLoader {\n  4\t    private let client: EpisodeClient\n  5\t\n  6\t    func load(_ id: EpisodeID) async throws -> Episode {\n  7\t        try await client.fetchEpisode(id)\n  8\t    }\n  9\t}",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      usage: USAGE,
      content: [
        {
          type: "text",
          text: "`load` goes straight to the client with no cache in between. I'll check the on-disk store first and fall back to the network, so a downloaded episode plays with the radio off.",
        },
        {
          type: "tool_use",
          id: "tu_3",
          name: "Edit",
          input: {
            file_path: "src/player/EpisodeLoader.swift",
            old_string: "        try await client.fetchEpisode(id)",
            new_string:
              "        if let cached = await store.episode(id) {\n            return cached\n        }\n\n        return try await client.fetchEpisode(id)",
          },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_3",
          content: "The file src/player/EpisodeLoader.swift has been updated.",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      usage: USAGE,
      content: [
        {
          type: "tool_use",
          id: "tu_4",
          name: "Bash",
          input: {
            command:
              "xcodebuild test -scheme Aurora -destination 'platform=iOS Simulator,name=iPhone 17 Pro'",
            description: "Run the player test suite",
          },
        },
      ],
    },
  },
  {
    type: "system",
    subtype: "session_state_changed",
    state: "running",
  },
];

/** One agent's transcript, mid-run — "see what the agent sees". */
export const agent: FixtureScenario = {
  id: "agent",
  route: "/sessions/ses_offline/agents",
  activeAgents: { ses_offline: AGENT_ID },
  storage: {
    ...BASE_STORAGE,
    // Seeded rather than pushed as an event: the chat resolves its context
    // window on first render, before any `agent:capabilities` could arrive.
    "argus:last-capabilities": {
      models: CAPABILITIES.models,
      slashCommands: [],
    },
  },
  events: [
    ...AGENTS.map((a) => ({ channel: "agent:started", payload: a })),
    {
      channel: `agent:capabilities:${AGENT_ID}`,
      payload: CAPABILITIES,
      delayMs: 1,
    },
    ...streamed(TRANSCRIPT),
  ],
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
  },
};
