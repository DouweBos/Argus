import type { FixtureEvent, FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE } from "./aurora";
import {
  AGENT_ID,
  CAPABILITIES,
  MODEL,
  devicePanel,
  ev,
  finished,
  prompt,
  say,
  tool,
  toolResult,
} from "./stream";

export { AGENT_ID, CAPABILITIES } from "./stream";

const TEST_OUTPUT = `Test Case 'EpisodeLoaderTests.testDownloadedEpisodePlaysOffline' passed (0.014 seconds)
Test Case 'EpisodeLoaderTests.testFallsBackToNetworkWhenNotCached' passed (0.009 seconds)
Test Case 'EpisodeLoaderTests.testEvictedEpisodeRefetches' passed (0.011 seconds)
Executed 48 tests, with 0 failures (0 unexpected) in 3.412 seconds
** TEST SUCCEEDED **`;

/** A whole turn: asked, investigated, edited, tested, summed up. */
export const TRANSCRIPT: FixtureEvent[] = [
  prompt(
    "Downloaded episodes spin forever in airplane mode. Make the player read from the download cache first and only hit the network when the episode isn't on disk.",
  ),
  ev({
    type: "system",
    subtype: "init",
    model: MODEL,
    session_id: "conv_offline",
    tools: [
      { name: "Read" },
      { name: "Edit" },
      { name: "Bash" },
      { name: "Grep" },
    ],
  }),
  tool(
    "tu_1",
    "Grep",
    { pattern: "func fetchEpisode", output_mode: "files_with_matches" },
    "The player fetches every episode from the network. I'll find where that fetch happens.",
  ),
  toolResult(
    "tu_1",
    "src/player/EpisodeLoader.swift\nsrc/net/EpisodeClient.swift",
  ),
  tool("tu_2", "Read", {
    file_path: "src/player/EpisodeLoader.swift",
    limit: 60,
  }),
  toolResult(
    "tu_2",
    "  1\timport Foundation\n  2\t\n  3\tactor EpisodeLoader {\n  4\t    private let client: EpisodeClient\n  5\t    private let store: DownloadStore\n  6\t\n  7\t    func load(_ id: EpisodeID) async throws -> Episode {\n  8\t        try await client.fetchEpisode(id)\n  9\t    }\n 10\t}",
  ),
  tool(
    "tu_3",
    "Edit",
    {
      file_path: "src/player/EpisodeLoader.swift",
      old_string: "        try await client.fetchEpisode(id)",
      new_string:
        "        if let cached = await store.episode(id) {\n            return cached\n        }\n\n        return try await client.fetchEpisode(id)",
    },
    "`load` goes straight to the client even though `DownloadStore` is right there. I'll check the store first and fall back to the network.",
  ),
  toolResult(
    "tu_3",
    "The file src/player/EpisodeLoader.swift has been updated.",
  ),
  tool("tu_4", "Bash", {
    command:
      "xcodebuild test -scheme Aurora -only-testing:AuroraTests/EpisodeLoaderTests",
    description: "Run the player tests",
  }),
  toolResult("tu_4", TEST_OUTPUT),
  say(
    "Downloaded episodes now play offline.\n\n- **`EpisodeLoader.load`** reads `DownloadStore` first and only calls the network for episodes that aren't on disk.\n- **Tests:** all 48 pass, including the offline case that failed before.\n\nThe simulator on the right is in airplane mode, playing from the cache.",
  ),
  finished(74_000, 0.31),
].map((event, index) => ({
  ...event,
  // Story seconds per event, so the fold reads as a real stretch of work.
  at: [0, 1, 4, 5, 9, 10, 21, 22, 27, 71, 74, 74][index],
  delayMs: 400 + index * 30,
}));

/** One agent's whole turn next to the app it's building — "see what the agent sees". */
export const agent: FixtureScenario = {
  id: "agent",
  route: "/sessions/ses_offline/agents",
  activeAgents: { ses_offline: AGENT_ID },
  deviceScreen: "aurora-downloads",
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
    ...TRANSCRIPT,
  ],
  channels: {
    ...BASE_CHANNELS,
    ...devicePanel("ses_offline"),
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
  },
};
