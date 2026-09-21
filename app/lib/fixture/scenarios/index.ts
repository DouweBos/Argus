import type { FixtureScenario } from "../types";
import { agent } from "./agent";
import { automations } from "./automations";
import { flock } from "./flock";
import { huddle } from "./huddle";
import { parallel } from "./parallel";
import { remote } from "./remote";
import { review } from "./review";

/**
 * `agent` is captured for regression cover only — it has no caption in the
 * site's sync script, so it never reaches the gallery. The `huddle` recording
 * shows the same transcript in the context that sells it.
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
