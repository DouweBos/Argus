import { loadAppSettings } from "../appSettings/store";

export const DEFAULT_THREAD_ROLLOVER_TURNS = 200;

/** Whether teammates may act on their own: duties' triggers, Slack and Linear. */
export function teammatesActive(): boolean {
  return loadAppSettings().teammates_enabled !== false;
}

export function threadRolloverTurns(): number {
  const configured = loadAppSettings().teammate_thread_rollover_turns;

  return typeof configured === "number" && configured >= 20
    ? Math.floor(configured)
    : DEFAULT_THREAD_ROLLOVER_TURNS;
}
