/**
 * Which computer an agent belongs to.
 *
 * A push notification only carries an agent id, so when one arrives for an
 * agent on a computer the app isn't currently connected to, this map is what
 * lets it switch to the right one instead of opening an empty transcript.
 */

import { readJson, writeJson } from "./storage";

const KEY = "agent.hosts";
const MAX_ENTRIES = 300;

type AgentHostMap = Record<string, string>;

let cache: AgentHostMap | null = null;

async function load(): Promise<AgentHostMap> {
  cache ??= await readJson<AgentHostMap>(KEY, {});

  return cache;
}

export async function hostForAgent(agentId: string): Promise<string | null> {
  return (await load())[agentId] ?? null;
}

/** Record the owning computer for agents the gateway just told us about. */
export async function rememberAgentHosts(
  hostId: string,
  agentIds: readonly string[],
): Promise<void> {
  if (agentIds.length === 0) {
    return;
  }
  const current = await load();
  const next: AgentHostMap = { ...current };
  for (const id of agentIds) {
    // Re-insert so the newest entries survive the trim below.
    delete next[id];
    next[id] = hostId;
  }
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    delete next[stale];
  }
  cache = next;
  await writeJson(KEY, next);
}

/** Drop a computer's agents when it's unpaired. */
export async function forgetHostAgents(hostId: string): Promise<void> {
  const current = await load();
  const next = Object.fromEntries(
    Object.entries(current).filter(([, id]) => id !== hostId),
  );
  cache = next;
  await writeJson(KEY, next);
}
