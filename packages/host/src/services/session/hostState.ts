/**
 * Whole-host reads: the snapshot a gateway client rebuilds from, and a single
 * session by id.
 */

import type { Session } from "./models";
import type { AgentInfo } from "../agent/models";
import { appState } from "../../state";
import { listAgents } from "../agent/agentService";
import { collectAllProjects, type ProjectEntry } from "../mcp/projectDiscovery";
import { listScratchPads } from "../scratchPad/manager";
import { listSessions } from "./manager";

export interface HostSnapshot {
  projects: ProjectEntry[];
  sessions: Session[];
  agents: AgentInfo[];
}

/**
 * Everything this host is running. Local IPC never drops so the desktop never
 * needs it; a client attaching over the gateway does, on every (re)connect.
 */
export async function hydrateHostState(): Promise<HostSnapshot> {
  const projects = collectAllProjects();
  const sessions: Session[] = [];
  const agents: AgentInfo[] = [];
  for (const project of projects.filter((p) => p.registered)) {
    const projectSessions = await listSessions(project.path);
    sessions.push(...projectSessions);
    for (const session of projectSessions) {
      agents.push(...listAgents(session.id));
    }
  }

  for (const pad of listScratchPads()) {
    sessions.push(pad);
    agents.push(...listAgents(pad.id));
  }

  return { projects, sessions, agents };
}

export function getSession(id: string): Session | null {
  return appState.sessions.get(id) ?? null;
}
