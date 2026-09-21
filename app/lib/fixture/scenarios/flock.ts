import type { FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE } from "./aurora";

/**
 * The same workspace as `parallel`, but the agents arrive one at a time so the
 * recording shows the flock filling in rather than a finished list.
 */
export const flock: FixtureScenario = {
  id: "flock",
  route: "/",
  storage: BASE_STORAGE,
  beats: [
    { holdSeconds: 1.8 },
    ...AGENTS.map((a) => ({
      events: [{ channel: "agent:started", payload: a }],
      // Long enough to read the branch name that just appeared — the point is
      // that these are five different jobs, not five copies of one.
      holdSeconds: 1.9,
    })),
    // Back to Home: starting an agent focuses its session, so the last frame
    // would otherwise be one agent's empty panel instead of the whole flock.
    { route: "/", holdSeconds: 4 },
  ],
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
  },
};
