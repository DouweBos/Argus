/**
 * Which machine answers a given IPC call.
 *
 * Several hosts are attached at once, so "where does this run" can never be
 * ambient. It is resolved per call, in this order:
 *
 * 1. an explicit target — `invokeOn(hostId, …)` / `runOnHost(hostId, fn)`;
 * 2. the call's own subject — a session, agent, terminal or repo root already
 *    belongs to exactly one host (`hostIndex`). This is the routing key, and
 *    it covers almost everything the UI does;
 * 3. the focused host in the URL, for calls that name nothing (`list_devices`
 *    on the Devices screen);
 * 4. this Mac.
 *
 * Commands that are about the client itself — settings, pairing, the updater —
 * never reach a host at all: `commandTarget()` pins them local inside the
 * remote transport.
 */

import { getCurrentRoute } from "../router";
import { LOCAL_HOST_ID, type HostId } from "./hostId";
import { agentHost, projectHost, sessionHost, terminalHost } from "./hostIndex";
import { commandTarget } from "./routing";

/**
 * Explicit target for the call being made right now. Set and cleared
 * synchronously around a single wrapper call, so it can never leak into an
 * unrelated one — `invoke()` reads it before its first await.
 */
let override: HostId | null = null;

/** Run `fn` with every IPC call inside it pinned to `hostId`. */
export function runOnHost<T>(hostId: HostId, fn: () => T): T {
  const previous = override;
  override = hostId;
  try {
    return fn();
  } finally {
    override = previous;
  }
}

const SESSION_KEYS = ["sessionId", "session_id"];
const AGENT_KEYS = ["agentId", "agent_id"];
const TERMINAL_KEYS = ["terminalId", "terminal_id"];
const ROOT_KEYS = [
  "repoRoot",
  "repo_root",
  "projectRoot",
  "projectPath",
  "root",
];

function pick(args: Record<string, unknown> | undefined, keys: string[]) {
  if (!args) {
    return null;
  }
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

/** The host a call's subject belongs to, or null when it names no subject. */
export function subjectHostId(args?: Record<string, unknown>): HostId | null {
  const sessionId = pick(args, SESSION_KEYS);
  if (sessionId) {
    const owner = sessionHost(sessionId);
    if (owner) {
      return owner;
    }
  }
  const agentId = pick(args, AGENT_KEYS);
  if (agentId) {
    const owner = agentHost(agentId);
    if (owner) {
      return owner;
    }
  }
  const terminalId = pick(args, TERMINAL_KEYS);
  if (terminalId) {
    const owner = terminalHost(terminalId);
    if (owner) {
      return owner;
    }
  }
  const repoRoot = pick(args, ROOT_KEYS);
  if (repoRoot) {
    const owner = projectHost(repoRoot);
    if (owner) {
      return owner;
    }
  }

  return null;
}

export function resolveHostId(
  channel: string,
  args?: Record<string, unknown>,
): HostId {
  if (override) {
    return override;
  }
  // This client's own trust store, updater and window commands answer here
  // whichever host the view is reading from.
  if (commandTarget(channel) === "client") {
    return LOCAL_HOST_ID;
  }

  return subjectHostId(args) ?? getCurrentRoute().hostId ?? LOCAL_HOST_ID;
}
