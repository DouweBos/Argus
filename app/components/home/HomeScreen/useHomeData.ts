import type { AgentStatus, DeviceInfo, Session } from "../../../lib/types";
import type { AgentStatus as PeacockAgentStatus } from "@argus/peacock";
import { useMemo } from "react";
import { projectAccent } from "@argus/peacock";
import { useRouteHostId } from "../../../lib/routeHooks";
import {
  hostScopedKey,
  isLocalHost,
  type HostId,
} from "../../../lib/transport/hostId";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  firstUserText,
  useConversations,
} from "../../../stores/conversationStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  useRecentProjects,
  type RecentProject,
} from "../../../stores/recentProjectsStore";
import { sessionHostId, useSessions } from "../../../stores/sessionStore";

export interface HomeAgent {
  branch: string;
  displayName: string;
  id: string;
  session: Session;
  status: PeacockAgentStatus;
}

export interface HomeProject {
  accent: string;
  agents: HomeAgent[];
  /** The machine this repo lives on — the same path can exist on several. */
  hostId: HostId;
  /** `hostScopedKey(hostId, path)`, not the path: two hosts, two rows. */
  id: string;
  /** Timestamp of the most recent agent creation in this project, or null if none. */
  lastAgentCreatedAt: number | null;
  lastOpened: number;
  name: string;
  path: string;
  sessions: Session[];
}

export interface HomeStats {
  agentsIdle: number;
  agentsRunning: number;
  devicesRunning: number;
  devicesTotal: number;
  projects: number;
  sessions: number;
}

export interface HomeData {
  activeAgents: HomeAgent[];
  devices: DeviceInfo[];
  projects: HomeProject[];
  stats: HomeStats;
}

function mapAgentStatus(status: AgentStatus["status"]): PeacockAgentStatus {
  switch (status) {
    case "running":
      return "running";
    case "error":
      return "error";
    case "stopped":
      return "done";
    default:
      return "idle";
  }
}

function formatLastOpened(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) {
    return "just now";
  }
  const m = Math.floor(delta / 60_000);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);

  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function useHomeData(): HomeData & {
  formatLastOpened: typeof formatLastOpened;
} {
  const recent = useRecentProjects();
  const sessions = useSessions();
  const agentsRecord = useAgentsRecord();
  const conversations = useConversations();
  const devices = useDevices();
  // This Mac's home is the combined view — every machine's projects, each
  // badged. A paired machine's tab shows only what lives on that machine.
  const routeHostId = useRouteHostId();

  const showsEveryHost = isLocalHost(routeHostId);

  return useMemo(() => {
    const projectsByKey = new Map<string, HomeProject>();

    recent.forEach((rp: RecentProject) => {
      if (!showsEveryHost && rp.hostId !== routeHostId) {
        return;
      }
      projectsByKey.set(hostScopedKey(rp.hostId, rp.path), {
        id: hostScopedKey(rp.hostId, rp.path),
        hostId: rp.hostId,
        name: rp.name,
        path: rp.path,
        // Keyed by path so one repo keeps its colour on every machine.
        accent: projectAccent(rp.path),
        sessions: [],
        agents: [],
        lastOpened: rp.lastOpened,
        lastAgentCreatedAt: null,
      });
    });

    sessions.forEach((ws) => {
      // Automation runs and scratch pads live in plain directories, not projects.
      if (ws.kind === "automation_host" || ws.kind === "scratch_pad") {
        return;
      }
      const hostId = sessionHostId(ws.id);
      if (!showsEveryHost && hostId !== routeHostId) {
        return;
      }
      const key = hostScopedKey(hostId, ws.repo_root);
      let proj = projectsByKey.get(key);
      if (!proj) {
        proj = {
          id: key,
          hostId,
          name: basename(ws.repo_root),
          path: ws.repo_root,
          accent: projectAccent(ws.repo_root),
          sessions: [],
          agents: [],
          // Unknown — place at the top of the list by using a sentinel.
          lastOpened: 0,
          lastAgentCreatedAt: null,
        };
        projectsByKey.set(key, proj);
      }
      proj.sessions.push(ws);
    });

    const activeAgents: HomeAgent[] = [];
    Object.values(agentsRecord).forEach((a) => {
      const ws = sessions.find((w) => w.id === a.session_id);
      if (!ws) {
        return;
      }
      const conv = conversations[a.agent_id];
      const convTitle = conv?.title?.trim();
      const firstText = firstUserText(conv)?.trim();
      const displayName =
        convTitle || firstText || ws.display_name || ws.branch;
      const entry: HomeAgent = {
        id: a.agent_id,
        branch: ws.branch,
        displayName,
        status: mapAgentStatus(a.status),
        session: ws,
      };
      const proj = projectsByKey.get(
        hostScopedKey(sessionHostId(ws.id), ws.repo_root),
      );
      if (proj) {
        proj.agents.push(entry);
        if (typeof a.created_at === "number") {
          proj.lastAgentCreatedAt = Math.max(
            proj.lastAgentCreatedAt ?? 0,
            a.created_at,
          );
        }
      }
      activeAgents.push(entry);
    });

    const projects = Array.from(projectsByKey.values()).sort((a, b) => {
      const aKey = a.lastAgentCreatedAt ?? a.lastOpened;
      const bKey = b.lastAgentCreatedAt ?? b.lastOpened;

      return bKey - aKey;
    });

    const stats: HomeStats = {
      agentsRunning: activeAgents.filter((a) => a.status === "running").length,
      agentsIdle: activeAgents.filter((a) => a.status === "idle").length,
      devicesRunning: devices.filter((d) => d.online).length,
      devicesTotal: devices.length,
      sessions: sessions.length,
      projects: projects.length,
    };

    return { projects, activeAgents, devices, stats, formatLastOpened };
  }, [
    recent,
    sessions,
    agentsRecord,
    conversations,
    devices,
    routeHostId,
    showsEveryHost,
  ]);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export { formatLastOpened };
