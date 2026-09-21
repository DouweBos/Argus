import type { FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE } from "./aurora";

/** Five agents fanned out across isolated worktrees — "parallel by default". */
export const parallel: FixtureScenario = {
  id: "parallel",
  route: "/",
  storage: BASE_STORAGE,
  // Locally an agent only reaches the renderer as an `agent:started` event —
  // there is no list the home screen can pull it from.
  events: AGENTS.map((a) => ({ channel: "agent:started", payload: a })),
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
  },
};
