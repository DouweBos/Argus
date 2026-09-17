/**
 * Which host owns a given project, session, agent or terminal.
 *
 * This is the routing table behind `resolveHostId()`: an IPC call naming a
 * session is answered by the machine that session's worktree lives on, and
 * nothing else. Entries are learned as the UI meets them — on hydration, on
 * `session:created`, on agent spawn — and dropped wholesale when a host is
 * detached.
 */

import { LOCAL_HOST_ID, type HostId } from "./hostId";

const projectHosts = new Map<string, HostId>();
const sessionHosts = new Map<string, HostId>();
const agentHosts = new Map<string, HostId>();
const terminalHosts = new Map<string, HostId>();

const TABLES = [projectHosts, sessionHosts, agentHosts, terminalHosts];

export function rememberProjectHost(repoRoot: string, hostId: HostId): void {
  projectHosts.set(repoRoot, hostId);
}

export function rememberSessionHost(sessionId: string, hostId: HostId): void {
  sessionHosts.set(sessionId, hostId);
}

export function rememberAgentHost(agentId: string, hostId: HostId): void {
  agentHosts.set(agentId, hostId);
}

export function rememberTerminalHost(terminalId: string, hostId: HostId): void {
  terminalHosts.set(terminalId, hostId);
}

export function projectHost(repoRoot: string): HostId | null {
  return projectHosts.get(repoRoot) ?? null;
}

export function sessionHost(sessionId: string): HostId | null {
  return sessionHosts.get(sessionId) ?? null;
}

export function agentHost(agentId: string): HostId | null {
  return agentHosts.get(agentId) ?? null;
}

export function terminalHost(terminalId: string): HostId | null {
  return terminalHosts.get(terminalId) ?? null;
}

/** Drop everything a host owned — called on detach so nothing routes to it. */
export function forgetHost(hostId: HostId): void {
  for (const table of TABLES) {
    for (const [key, owner] of table) {
      if (owner === hostId) {
        table.delete(key);
      }
    }
  }
}

/** Test seam. */
export function resetHostIndex(): void {
  for (const table of TABLES) {
    table.clear();
  }
}

/**
 * Everything the local main process owns by default. Called once at boot so a
 * call naming a local session never falls through to the focused remote host.
 */
export function claimForLocal(repoRoots: string[]): void {
  for (const root of repoRoots) {
    projectHosts.set(root, LOCAL_HOST_ID);
  }
}
