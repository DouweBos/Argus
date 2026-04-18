import type { AgentStatus, DeviceInfo, Workspace } from "../../../lib/types";
import type { AgentStatus as PeacockAgentStatus } from "@argus/peacock";
import { useMemo } from "react";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useDevices } from "../../../stores/deviceStore";
import {
  useRecentProjects,
  type RecentProject,
} from "../../../stores/recentProjectsStore";
import { useWorkspaces } from "../../../stores/workspaceStore";

export interface HomeAgent {
  branch: string;
  id: string;
  status: PeacockAgentStatus;
  workspace: Workspace;
}

export interface HomeProject {
  accent: string;
  agents: HomeAgent[];
  id: string;
  lastOpened: number;
  name: string;
  path: string;
  workspaces: Workspace[];
}

export interface HomeStats {
  agentsIdle: number;
  agentsRunning: number;
  devicesRunning: number;
  devicesTotal: number;
  projects: number;
  workspaces: number;
}

export interface HomeData {
  activeAgents: HomeAgent[];
  devices: DeviceInfo[];
  projects: HomeProject[];
  stats: HomeStats;
}

/** Colors assigned to projects in order of recency, cycling if exhausted. */
const PROJECT_ACCENTS = [
  "#4d9fff",
  "#7c5cfc",
  "#00d4aa",
  "#f5a623",
  "#ff4466",
  "#55556a",
];

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
  const workspaces = useWorkspaces();
  const agentsRecord = useAgentsRecord();
  const devices = useDevices();

  return useMemo(() => {
    const projectsByPath = new Map<string, HomeProject>();

    recent.forEach((rp: RecentProject, i) => {
      projectsByPath.set(rp.path, {
        id: rp.path,
        name: rp.name,
        path: rp.path,
        accent: PROJECT_ACCENTS[i % PROJECT_ACCENTS.length] ?? "#4d9fff",
        workspaces: [],
        agents: [],
        lastOpened: rp.lastOpened,
      });
    });

    workspaces.forEach((ws) => {
      const key = ws.repo_root;
      let proj = projectsByPath.get(key);
      if (!proj) {
        proj = {
          id: key,
          name: basename(key),
          path: key,
          accent:
            PROJECT_ACCENTS[projectsByPath.size % PROJECT_ACCENTS.length] ??
            "#4d9fff",
          workspaces: [],
          agents: [],
          // Unknown — place at the top of the list by using a sentinel.
          lastOpened: 0,
        };
        projectsByPath.set(key, proj);
      }
      proj.workspaces.push(ws);
    });

    const activeAgents: HomeAgent[] = [];
    Object.values(agentsRecord).forEach((a) => {
      const ws = workspaces.find((w) => w.id === a.workspace_id);
      if (!ws) {
        return;
      }
      const entry: HomeAgent = {
        id: a.agent_id,
        branch: ws.branch,
        status: mapAgentStatus(a.status),
        workspace: ws,
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
      workspaces: workspaces.length,
      projects: projects.length,
    };

    return { projects, activeAgents, devices, stats, formatLastOpened };
  }, [recent, workspaces, agentsRecord, devices]);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export { formatLastOpened };
