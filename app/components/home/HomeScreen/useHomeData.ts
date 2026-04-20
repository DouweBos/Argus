import type { AgentStatus, DeviceInfo, Session } from "../../../lib/types";
import type { AgentStatus as PeacockAgentStatus } from "@argus/peacock";
import { useMemo } from "react";
import { projectAccent } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useConversations } from "../../../stores/conversationStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  useRecentProjects,
  type RecentProject,
} from "../../../stores/recentProjectsStore";
import { useSessions } from "../../../stores/sessionStore";

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
  id: string;
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

  return useMemo(() => {
    const projectsByPath = new Map<string, HomeProject>();

    recent.forEach((rp: RecentProject) => {
      projectsByPath.set(rp.path, {
        id: rp.path,
        name: rp.name,
        path: rp.path,
        accent: projectAccent(rp.path),
        sessions: [],
        agents: [],
        lastOpened: rp.lastOpened,
      });
    });

    sessions.forEach((ws) => {
      const key = ws.repo_root;
      let proj = projectsByPath.get(key);
      if (!proj) {
        proj = {
          id: key,
          name: basename(key),
          path: key,
          accent: projectAccent(key),
          sessions: [],
          agents: [],
          // Unknown — place at the top of the list by using a sentinel.
          lastOpened: 0,
        };
        projectsByPath.set(key, proj);
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
      const firstUserText = conv?.messages
        ?.find((m) => m.role === "user")
        ?.textBlocks?.[0]?.trim();
      const displayName =
        convTitle || firstUserText || ws.display_name || ws.branch;
      const entry: HomeAgent = {
        id: a.agent_id,
        branch: ws.branch,
        displayName,
        status: mapAgentStatus(a.status),
        session: ws,
      };
      const proj = projectsByPath.get(ws.repo_root);
      if (proj) {
        proj.agents.push(entry);
      }
      activeAgents.push(entry);
    });

    const projects = Array.from(projectsByPath.values()).sort(
      (a, b) => b.lastOpened - a.lastOpened,
    );

    const stats: HomeStats = {
      agentsRunning: activeAgents.filter((a) => a.status === "running").length,
      agentsIdle: activeAgents.filter((a) => a.status === "idle").length,
      devicesRunning: devices.filter((d) => d.online).length,
      devicesTotal: devices.length,
      sessions: sessions.length,
      projects: projects.length,
    };

    return { projects, activeAgents, devices, stats, formatLastOpened };
  }, [recent, sessions, agentsRecord, conversations, devices]);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export { formatLastOpened };
