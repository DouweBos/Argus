import type { FixtureEvent, FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE, NOW } from "./aurora";
import {
  AGENT_ID,
  CAPABILITIES,
  devicePanel,
  finished,
  prompt,
  say,
  tool,
  toolResult,
} from "./stream";

const ROOM_ID = "room_9f2c";

/** What a huddle guest types reaches the desktop as a remote message. */
function guestSays(author: string, message: string): FixtureEvent {
  return {
    channel: `agent:remote-message:${AGENT_ID}`,
    payload: { author, message },
  };
}

function guest(label: string, state: "approved" | "pending") {
  return {
    member_id: `mem_${label.toLowerCase()}`,
    dev_static_pub: `pub_${label.length}`,
    client_id: `cli_${label.length}`,
    label,
    state,
    joined_at: NOW - 60_000,
    approved_at: state === "approved" ? NOW - 30_000 : null,
    connected: true,
    typing: false,
  };
}

function room(guests: ReturnType<typeof guest>[]) {
  return {
    id: ROOM_ID,
    token: "t_5Qx1r8",
    agent_id: AGENT_ID,
    device_key: "ios-ses_offline",
    url: "https://aurora-mini.tail9c2f.ts.net/h/5Qx1r8",
    created_at: NOW - 6 * 60_000,
    expires_at: NOW + 54 * 60_000,
    guests,
    host_typing: false,
    host_label: "Sam",
    chat: [],
  };
}

function rooms(list: unknown[]) {
  return { channel: "huddle:changed", payload: { rooms: list } };
}

/** Where the agent already is by the time the recording starts. */
const OPENING: FixtureEvent[] = [
  prompt(
    "Downloaded episodes spin forever in airplane mode. Make the player read from the download cache first.",
  ),
  say(
    "Downloads stream straight from the network layer, so airplane mode drops them. I'll put a cache read in front of the fetch.",
  ),
  tool("t1", "Read", {
    file_path: "src/player/EpisodeLoader.swift",
    limit: 60,
  }),
  toolResult(
    "t1",
    "  6\t    func load(_ id: EpisodeID) async throws -> Episode {\n  7\t        try await client.fetchEpisode(id)\n  8\t    }",
  ),
  tool("t2", "Edit", {
    file_path: "src/player/EpisodeLoader.swift",
    old_string: "        try await client.fetchEpisode(id)",
    new_string:
      "        if let cached = await store.episode(id) {\n            return cached\n        }\n\n        return try await client.fetchEpisode(id)",
  }),
  toolResult("t2", "The file src/player/EpisodeLoader.swift has been updated."),
].map((event, index) => ({
  ...event,
  at: [0, 3, 5, 6, 14, 15][index],
  delayMs: 2 + index,
}));

/**
 * The whole collaboration story: a designer is handed a link to one running
 * agent, joins it, asks for a change in the chat, and watches the agent make
 * it. Told in beats so the clip reads as a conversation rather than a slideshow
 * of states.
 */
export const huddle: FixtureScenario = {
  id: "huddle",
  route: "/sessions/ses_offline/agents",
  activeAgents: { ses_offline: AGENT_ID },
  deviceScreen: "aurora-downloads",
  storage: {
    ...BASE_STORAGE,
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
    ...OPENING,
  ],
  /** The knock — the one frame that says "someone else is here". */
  posterBeat: 1,
  beats: [
    { events: [rooms([room([])])], holdSeconds: 2.6 },
    { events: [rooms([room([guest("Nadia", "pending")])])], holdSeconds: 3.6 },
    { events: [rooms([room([guest("Nadia", "approved")])])], holdSeconds: 2.4 },
    {
      events: [
        guestSays(
          "Nadia",
          "Can the episode row show its cached badge the moment the file lands? Right now it only turns up after a refresh.",
        ),
      ],
      holdSeconds: 4.4,
    },
    {
      events: [
        say(
          "Good catch. The row reads a snapshot of the library, so it won't repaint until the next refresh. I'll publish the cache write so it updates as soon as the download finishes.",
        ),
      ],
      holdSeconds: 4.2,
    },
    {
      events: [
        tool("t3", "Edit", {
          file_path: "src/library/EpisodeStore.swift",
          old_string: "    private(set) var cached: Set<EpisodeID> = []",
          new_string:
            "    @Published private(set) var cached: Set<EpisodeID> = []",
        }),
      ],
      holdSeconds: 3.4,
    },
    {
      events: [
        toolResult(
          "t3",
          "The file src/library/EpisodeStore.swift has been updated.",
        ),
        say("Done — the badge appears the moment the download completes."),
      ],
      holdSeconds: 4.4,
    },
    {
      events: [finished(42_000, 0.19)],
      holdSeconds: 3.6,
    },
  ],
  channels: {
    ...BASE_CHANNELS,
    ...devicePanel("ses_offline"),
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
    huddle_list: [room([])],
  },
};
