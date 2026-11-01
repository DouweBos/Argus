/**
 * What a pane's top bar calls its screen. The URL carries ids only, so names
 * come from whatever the stores already hold, with a neutral fallback while
 * they load.
 */

import { fileNameOf } from "@argus/client-core";
import type { RemoteAgentStatus } from "../lib/protocol";
import { projectKey, type Screen } from "../routing/screens";
import { useAgentsStore } from "../stores/agents";
import { useDevicesStore } from "../stores/devices";
import { useProjectsStore } from "../stores/projects";

export function agentLabel(
  agentId: string,
  agent: Pick<RemoteAgentStatus, "title"> | undefined,
): string {
  return agent?.title?.trim() || `Agent ${agentId.slice(0, 8)}`;
}

export function useScreenTitle(screen: Screen): string {
  const projects = useProjectsStore((s) => s.projects);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const statusByAgent = useAgentsStore((s) => s.statusByAgent);
  const devices = useDevicesStore((s) => s.devices);

  function withSession(title: string, sessionId: string): string {
    const session = Object.values(sessionsByRepo)
      .flat()
      .find((s) => s.id === sessionId);
    const label = session?.display_name ?? session?.branch;

    return label ? `${title} · ${label}` : title;
  }

  switch (screen.name) {
    case "projects":
      return "Projects";
    case "project":
      return (
        projects.find((p) => projectKey(p.repo_root) === screen.projectKey)
          ?.name ?? "Project"
      );
    case "settings":
      return "Settings";
    case "devices":
      return "Devices";
    case "device":
      return (
        devices.find(
          (d) => d.id === screen.deviceKey && d.platform === screen.platform,
        )?.name ?? "Device"
      );
    case "session":
      return "Session";
    case "agent":
      return agentLabel(
        screen.agentId,
        statusByAgent[screen.agentId] ??
          recentAgents.find((a) => a.agent_id === screen.agentId),
      );
    case "changes":
      return withSession("Changes", screen.sessionId);
    case "files":
      return withSession("Files", screen.sessionId);
    case "search":
      return withSession("Search", screen.sessionId);
    case "terminals":
      return withSession("Terminals", screen.sessionId);
    case "file":
    case "fileDiff":
      return fileNameOf(screen.path);
  }
}
