import type { FixtureScenario } from "../types";
import { agent } from "./agent";
import { automations } from "./automations";
import { flock } from "./flock";
import { huddle } from "./huddle";
import { parallel } from "./parallel";
import { remote } from "./remote";
import { review } from "./review";

/**
 * `agent` is the still hero: one whole turn next to the app on its simulator.
 * The `huddle` recording tells the same task as a collaboration.
 */
export const scenarios: Record<string, FixtureScenario> = {
  [parallel.id]: parallel,
  [review.id]: review,
  [huddle.id]: huddle,
  [flock.id]: flock,
  [agent.id]: agent,
  [automations.id]: automations,
  [remote.id]: remote,
};
