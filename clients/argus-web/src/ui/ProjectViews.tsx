/**
 * Project and session browsing — the master pane's content. Split out of
 * App.tsx to keep each file under the size guideline.
 */

import { useCallback, useEffect } from "react";
import { loadPhase, shortAge, usageAccountViews } from "@argus/client-core";
import {
  AgentRow,
  Banner,
  EmptyState,
  HomeLink,
  HomeNote,
  HomeOverview,
  HomeSection,
  Icons,
  ProjectTile,
  ProjectTileGrid,
  Spinner,
  UsageMeter,
} from "@argus/peacock";
import type { RemoteAgentStatus, RemoteProject } from "../lib/protocol";
import type { AgentRef } from "../routing/open";
import { appNavigate } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import { useProjectsStore } from "../stores/projects";
import { useUsageStore } from "../stores/usage";
import {
  agentAwaitingLabel,
  agentMetaLabel,
  mapAgentStatus,
} from "./agentStatus";
import { NewSessionForm, SessionGroup } from "./SessionViews";
import { PUSHED_LIST_REFRESH_MS, useLiveRefresh } from "./useLiveRefresh";

function Loading({ label }: { label: string }) {
  return (
    <div className="aw-center">
      <Spinner />
      <span className="aw-muted">{label}</span>
    </div>
  );
}

/** Most-recently-active agents across all projects — a quick jump back to what
 *  you're driving. Shown on Home and inside a project's session view. */
function RecentAgents({
  onOpenAgent,
}: {
  onOpenAgent: (agent: AgentRef) => void;
}) {
  const recentAgents = useProjectsStore((s) => s.recentAgents);
  const recent = [...recentAgents]
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
    .slice(0, 8);

  if (recent.length === 0) {
    return null;
  }

  return (
    <HomeSection className="aw-recent-agents" title="Recent agents">
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
            className="aw-clickable"
            role="button"
            tabIndex={0}
            onClick={() => onOpenAgent(a)}
          />
        );
      })}
    </HomeSection>
  );
}

/** A project's tile on Home: what's in it and how long since it moved. */
function HomeProjectTile({
  project,
  onOpen,
}: {
  project: RemoteProject;
  onOpen: (repoRoot: string) => void;
}) {
  const sessions = useProjectsStore((s) => s.sessionsByRepo[project.repo_root]);
  const agents = useProjectsStore((s) => s.agentsByRepo[project.repo_root]);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const worktrees = (sessions ?? []).filter((s) => s.kind === "worktree").length;
  const live = agents ?? [];
  const busy = live.some((a) => a.status === "running");
  const waiting = live.some((a) => a.awaiting);
  const times = live
    .map((a) => a.last_activity_at ?? a.created_at)
    .filter((t): t is number => typeof t === "number");
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <ProjectTile
      age={times.length > 0 ? `${shortAge(Math.max(...times))} ago` : undefined}
      busy={busy}
      name={project.name}
      projectKey={project.repo_root}
      status={waiting ? "warning" : busy ? "accent" : "idle"}
      summary={`${plural(worktrees, "session")} · ${plural(live.length, "agent")}`}
      onNewSession={hasControl ? () => onOpen(project.repo_root) : undefined}
      onOpen={() => onOpen(project.repo_root)}
    />
  );
}

/** Plan limits for the signed-in account, when Claude reports them. */
function HomeLimits() {
  const connection = useConnectionStore((s) => s.connection);
  const limits = useUsageStore((s) => s.limits);
  const limitsAt = useUsageStore((s) => s.limitsAt);
  const loadLimits = useUsageStore((s) => s.loadLimits);
  useEffect(() => {
    if (connection === "ready") {
      loadLimits({ background: true }).catch(() => {});
    }
  }, [connection, loadLimits]);
  const windows = limits
    ? (usageAccountViews(limits, limitsAt).find((a) => a.state === "ok")
        ?.windows ?? [])
    : [];
  if (windows.length === 0) {
    return null;
  }

  return (
    <HomeSection
      actions={
        <HomeLink
          onClick={() =>
            appNavigate({ name: "usage", tab: "limits", range: "30d" })
          }
        >
          View usage
        </HomeLink>
      }
      title="Plan limits"
    >
      <div className="aw-home-limits">
        {windows.map((w) => (
          <UsageMeter
            key={w.id}
            hint={w.hint?.replace(/^Resets/, "resets") ?? undefined}
            label={w.label}
            progress={w.progress}
            size="row"
            tone={w.tone}
            value={w.value}
          />
        ))}
      </div>
    </HomeSection>
  );
}

/** Home, as on the Mac: plan limits, the projects, and what ran lately. */
export function Projects({
  onOpen,
  onOpenAgent,
}: {
  onOpen: (repoRoot: string) => void;
  onOpenAgent: (agent: AgentRef) => void;
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
  useLiveRefresh(connection === "ready", refresh, PUSHED_LIST_REFRESH_MS);

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

  return (
    <HomeOverview icon={<Icons.ArgusLogo size={16} />} title="Argus">
      {load.error && <Banner tone="warning">{load.error}</Banner>}
      <HomeLimits />
      <HomeSection title="Projects">
        {phase.kind === "failed" ? (
          <HomeNote>Couldn't load projects: {phase.error}</HomeNote>
        ) : phase.kind === "empty" ? (
          <HomeNote>
            No projects open. Open a repository in Argus on your computer and
            it'll show up here.
          </HomeNote>
        ) : (
          <ProjectTileGrid>
            {projects.map((p) => (
              <HomeProjectTile key={p.repo_root} project={p} onOpen={onOpen} />
            ))}
          </ProjectTileGrid>
        )}
      </HomeSection>
      <RecentAgents onOpenAgent={onOpenAgent} />
    </HomeOverview>
  );
}

export function Project({
  repoRoot,
  onOpenAgent,
  onOpenChanges,
}: {
  repoRoot: string;
  onOpenAgent: (agent: AgentRef) => void;
  onOpenChanges: (sessionId: string, label: string) => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const agents = useProjectsStore((s) => s.agentsByRepo[repoRoot]);
  const sessions = useProjectsStore((s) => s.sessionsByRepo[repoRoot]);
  const loadAgents = useProjectsStore((s) => s.loadAgents);
  const loadSessions = useProjectsStore((s) => s.loadSessions);
  const loadRecentAgents = useProjectsStore((s) => s.loadRecentAgents);
  const hasControl = useConnectionStore((s) => s.hasControl());

  const refresh = useCallback(() => {
    loadAgents(repoRoot).catch(() => {});
    loadSessions(repoRoot).catch(() => {});
    loadRecentAgents().catch(() => {});
  }, [loadAgents, loadSessions, loadRecentAgents, repoRoot]);
  useLiveRefresh(connection === "ready", refresh, PUSHED_LIST_REFRESH_MS);

  // A new agent starts from its session's composer, where its task and workspace are picked.
  const spawn = useCallback(
    (sessionId: string) => appNavigate({ name: "sessionHome", sessionId }),
    [],
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
