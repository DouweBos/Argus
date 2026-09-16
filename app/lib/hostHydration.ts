/**
 * Snapshot-on-connect for remote mode (§3.5).
 *
 * Local IPC never drops, so the renderer can treat its stores as coherent
 * forever. A gateway does drop — sleep, Wi-Fi switch, tunnel restart — and the
 * host keeps running agents while nobody is attached. So on connect, and again
 * after every reconnect, pull one snapshot and rebuild from it.
 *
 * `state_hydrate` gives it in a single round trip where the host implements it;
 * otherwise the same picture is composed from the ordinary commands, which the
 * admin passthrough makes reachable anyway.
 */

import type { HostSnapshot } from "./types";
import { setConnectionInfo } from "../stores/connectionStore";
import { hostStateSnapshot, listProjects } from "./ipc";
import { openProject } from "./projectsService";

/** One payload describing everything the host is running right now. */
export async function fetchHostSnapshot(): Promise<HostSnapshot> {
  try {
    return await hostStateSnapshot();
  } catch {
    const projects = await listProjects();

    return { projects, sessions: [], agents: [] };
  }
}

/**
 * Rebuild the project/session stores from the host. Projects come from the
 * host's registered roots, never this client's recent list — those are paths on
 * a different machine's disk.
 */
export async function hydrateFromHost(): Promise<void> {
  const snapshot = await fetchHostSnapshot();
  for (const project of snapshot.projects.filter((p) => p.registered)) {
    try {
      await openProject(project.path, {
        autoSelect: false,
        skipRecent: true,
      });
    } catch {
      // A project the host can no longer open shouldn't stop the rest.
    }
  }
  setConnectionInfo({ hydrated: true, lastError: null });
}
