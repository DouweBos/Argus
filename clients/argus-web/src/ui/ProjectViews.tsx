/**
 * Project and session browsing — the master pane's content. Split out of
 * App.tsx to keep each file under the size guideline.
 */

import { useCallback } from "react";
import { loadPhase } from "@argus/client-core";
import {
  AgentRow,
  Banner,
  EmptyState,
  Icons,
  projectAccent,
  SidebarRepoGroup,
  SidebarSection,
  Spinner,
} from "@argus/peacock";
import type { RemoteAgentStatus } from "../lib/protocol";
import { useAgentsStore } from "../stores/agents";
import { useConnectionStore } from "../stores/connection";
import { useProjectsStore } from "../stores/projects";
import {
  agentAwaitingLabel,
  agentMetaLabel,
  mapAgentStatus,
} from "./agentStatus";
import { NewSessionForm, SessionGroup } from "./SessionViews";
import { useLiveRefresh } from "./useLiveRefresh";

function Loading({ label }: { label: string }) {
  return (
    <div className="aw-center">
      <Spinner />
      <span className="aw-muted">{label}</span>
    </div>
  );
}

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
}


/** Most-recently-active agents across all projects — a quick jump back to what
 *  you're driving. Shown on Home and inside a project's session view. */
function RecentAgents({
  onOpenAgent,
}: {
  onOpenAgent: (agentId: string, label: string) => void;
}) {
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const recent = [...recentAgents]
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, 8);

  if (recent.length === 0) {
    return null;
  }

  return (
    <div className="aw-group">
      <SidebarSection count={recent.length}>Recent agents</SidebarSection>
      {recent.map((a) => {
        const name = a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`;

        return (
          <AgentRow
            key={a.agent_id}
            name={name}
            status={a.awaiting ? "pending" : mapAgentStatus(a.status)}
            meta={
              agentAwaitingLabel(a) ?? a.session_label ?? agentMetaLabel(a.status)
            }
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => onOpenAgent(a.agent_id, name)}
          />
        );
      })}
    </div>
  );
}

export function Projects({
  onOpen,
  onOpenAgent,
}: {
  onOpen: (repoRoot: string, name: string) => void;
  onOpenAgent: (agentId: string, label: string) => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const projects = useProjectsStore((s) => s.projects);
  const refreshProjects = useProjectsStore((s) => s.refreshProjects);
  const loadRecentAgents = useProjectsStore((s) => s.loadRecentAgents);
  const load = useProjectsStore((s) => s.projectsLoad);

  const refresh = useCallback(() => {
    refreshProjects({ background: true }).catch(() => {});
    loadRecentAgents().catch(() => {});
  }, [refreshProjects, loadRecentAgents]);
  useLiveRefresh(connection === "ready", refresh);

  const phase = loadPhase(load, projects.length === 0);
  if (phase.kind === "loading") {
    return (
      <Loading
        label={
          connection === "ready" ? "Loading projects…" : "Connecting to Argus…"
        }
      />
    );
  }
  if (phase.kind === "failed") {
    return (
      <EmptyState
        icon={<Icons.FolderIcon size={22} />}
        title="Couldn't load projects"
        body={phase.error}
      />
    );
  }
  if (phase.kind === "empty") {
    return (
      <EmptyState
        icon={<Icons.FolderIcon size={22} />}
        title="No projects open"
        body="Open a repository in Argus on your computer and it'll show up here."
      />
    );
  }

  return (
    <div className="aw-sidebar">
      {load.error && <Banner tone="warning">{load.error}</Banner>}
      <RecentAgents onOpenAgent={onOpenAgent} />
      <SidebarSection count={projects.length}>Projects</SidebarSection>
      {projects.map((p) => (
        <SidebarRepoGroup
          key={p.repo_root}
          name={p.name}
          title={p.repo_root}
          color={projectAccent(p.repo_root)}
          hideChevron
          leading={<Icons.FolderIcon size={11} />}
          subtitle={
            <span className="aw-truncate">{toTildePath(p.repo_root)}</span>
          }
          endContent={<Icons.ChevronRightIcon size={13} />}
          onHeaderClick={() => onOpen(p.repo_root, p.name)}
        />
      ))}
    </div>
  );
}

export function Project({
  repoRoot,
  onOpenAgent,
  onOpenChanges,
}: {
  repoRoot: string;
  onOpenAgent: (agentId: string, label: string) => void;
  onOpenChanges: (sessionId: string, label: string) => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const agents = useProjectsStore((s) => s.agentsByRepo[repoRoot]);
  const sessions = useProjectsStore((s) => s.sessionsByRepo[repoRoot]);
  const loadAgents = useProjectsStore((s) => s.loadAgents);
  const loadSessions = useProjectsStore((s) => s.loadSessions);
  const loadRecentAgents = useProjectsStore((s) => s.loadRecentAgents);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const spawnAgent = useAgentsStore((s) => s.spawnAgent);

  const refresh = useCallback(() => {
    loadAgents(repoRoot).catch(() => {});
    loadSessions(repoRoot).catch(() => {});
    loadRecentAgents().catch(() => {});
  }, [loadAgents, loadSessions, loadRecentAgents, repoRoot]);
  useLiveRefresh(connection === "ready", refresh);

  const spawn = useCallback(
    (sessionId: string) => {
      spawnAgent(sessionId)
        .then((a) =>
          onOpenAgent(
            a.agent_id,
            a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`,
          ),
        )
        .catch(() => {});
    },
    [spawnAgent, onOpenAgent],
  );

  if (agents === undefined) {
    return <Loading label="Loading agents…" />;
  }

  // Group by session id (stable), carrying a label + its agents.
  const groups = new Map<
    string,
    { agents: RemoteAgentStatus[]; label: string }
  >();
  for (const a of agents) {
    const g = groups.get(a.session_id) ?? {
      label: a.session_label ?? "Session",
      agents: [],
    };
    g.agents.push(a);
    groups.set(a.session_id, g);
  }
  for (const s of sessions ?? []) {
    if (!groups.has(s.id)) {
      groups.set(s.id, { label: s.display_name ?? s.branch, agents: [] });
    }
  }
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]));
  // Match the desktop sidebar: project_root sessions first, others keep order.
  const entries = [...groups.entries()].sort(([aId], [bId]) => {
    const aRoot = sessionById.get(aId)?.kind === "project_root";
    const bRoot = sessionById.get(bId)?.kind === "project_root";
    if (aRoot && !bRoot) return -1;
    if (!aRoot && bRoot) return 1;
    return 0;
  });

  return (
    <div className="aw-sidebar">
      {hasControl && (
        <div className="aw-control-bar">
          <NewSessionForm repoRoot={repoRoot} onCreated={refresh} />
        </div>
      )}

      {entries.length === 0 && (
        <EmptyState
          icon={<Icons.AgentIcon size={22} />}
          title="No agents running"
          body={
            hasControl
              ? "Create a session with “New session” above, then start an agent in it — or start one in Argus on your computer."
              : "Start an agent in this project from Argus on your computer and it'll appear here. This device can monitor and approve prompts; ask the desktop to grant it control to start agents and sessions remotely."
          }
        />
      )}

      {entries.map(([sessionId, g]) => (
        <SessionGroup
          key={sessionId}
          sessionId={sessionId}
          label={g.label}
          session={sessionById.get(sessionId)}
          agents={g.agents}
          repoRoot={repoRoot}
          hasControl={hasControl}
          onOpenAgent={onOpenAgent}
          onOpenChanges={onOpenChanges}
          onSpawn={spawn}
          onChanged={refresh}
        />
      ))}

      <RecentAgents onOpenAgent={onOpenAgent} />
    </div>
  );
}
