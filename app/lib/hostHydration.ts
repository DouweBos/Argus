/**
 * Snapshot-on-attach, per host (§3.5).
 *
 * Local IPC never drops, so the renderer can treat its stores as coherent
 * forever. A gateway does drop — sleep, Wi-Fi switch, tunnel restart — and the
 * host keeps running agents while nobody is attached. So on attach, and again
 * after every reconnect, pull one snapshot for *that host* and rebuild its
 * share of the sidebar from it. The other attached hosts are untouched.
 *
 * `state_hydrate` gives it in a single round trip where the host implements it;
 * otherwise the same picture is composed from the ordinary commands, which the
 * admin passthrough makes reachable anyway.
 */

import type { HostId } from "./transport/hostId";
import type { HostSnapshot } from "./types";
import { setHostConnection } from "../stores/connectionStore";
import { dropHostProjects as dropHostRecents } from "../stores/recentProjectsStore";
import {
  dropHostSessions,
  sessionHostId,
  getSessionState,
} from "../stores/sessionStore";
import { hostStateSnapshot, listProjects } from "./ipc";
import { openProject, purgeAgentsForSession } from "./projectsService";
import { rememberAgentHost, rememberSessionHost } from "./transport/hostIndex";
import { runOnHost } from "./transport/hostRouting";

/** One payload describing everything a host is running right now. */
export async function fetchHostSnapshot(hostId: HostId): Promise<HostSnapshot> {
  try {
    return await runOnHost(hostId, () => hostStateSnapshot());
  } catch {
    const projects = await runOnHost(hostId, () => listProjects());

    return { projects, sessions: [], agents: [] };
  }
}

/**
 * Rebuild one host's projects and sessions. Projects come from that host's
 * registered roots, never this client's recent list — those are paths on a
 * different machine's disk.
 */
export async function hydrateHost(hostId: HostId): Promise<void> {
  let snapshot: HostSnapshot;
  try {
    snapshot = await fetchHostSnapshot(hostId);
  } catch (err) {
    setHostConnection(hostId, {
      lastError: err instanceof Error ? err.message : String(err),
    });

    return;
  }

  // Claim ids before opening anything, so every follow-up command about them
  // is routed back to this host rather than the focused one.
  for (const session of snapshot.sessions) {
    rememberSessionHost(session.id, hostId);
  }
  for (const agent of snapshot.agents) {
    rememberAgentHost(agent.agent_id, hostId);
  }

  for (const project of snapshot.projects.filter((p) => p.registered)) {
    try {
      await openProject(project.path, {
        autoSelect: false,
        skipRecent: true,
        hostId,
      });
    } catch {
      // A project the host can no longer open shouldn't stop the rest.
    }
  }
  setHostConnection(hostId, { hydrated: true, lastError: null });
}

/** Remove a detached host's projects and sessions from every store. */
export function dropHostProjects(hostId: HostId): void {
  const owned = getSessionState()
    .sessions.filter((session) => sessionHostId(session.id) === hostId)
    .map((session) => session.id);
  for (const id of owned) {
    purgeAgentsForSession(id);
  }
  dropHostSessions(hostId);
  dropHostRecents(hostId);
}
