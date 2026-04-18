import type { HomeData, HomeProject } from "../useHomeData";
import { useMemo, useState } from "react";
import {
  CommitIcon,
  Icons,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderAction,
  SidebarItem,
  SidebarNav,
  SidebarNavGroup,
  SidebarRepoGroup,
  SidebarScroll,
  SidebarSection,
  SidebarWorkspaceRow,
  agentStatusPulse,
  agentStatusTone,
} from "@argus/peacock";

export type HomeSidebarView = "activity" | "home" | "review";

export interface HomeSidebarProps {
  data: HomeData;
  onAddRepository: () => void;
  onNewWorkspace: () => void;
  onOpenProject: (proj: HomeProject) => void;
  onOpenWorkspace: (workspaceId: string, repoPath: string) => void;
  onViewChange?: (view: HomeSidebarView) => void;
  view?: HomeSidebarView;
}

export function HomeSidebar({
  data,
  view = "home",
  onViewChange,
  onAddRepository,
  onNewWorkspace,
  onOpenProject,
  onOpenWorkspace,
}: HomeSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeProjects = data.projects.filter((p) => p.agents.length > 0);
  const recentProjects = data.projects.filter((p) => p.agents.length === 0);
  const totalAgents = data.projects.reduce((n, p) => n + p.agents.length, 0);
  const reviewCount = useMemo(
    () => data.activeAgents.filter((a) => a.status === "pending").length,
    [data.activeAgents],
  );
  const runningCount = data.activeAgents.filter(
    (a) => a.status === "running",
  ).length;

  const toggle = (id: string) => setCollapsed((s) => ({ ...s, [id]: !s[id] }));

  return (
    <SidebarNav framed aria-label="Home sidebar">
      <SidebarHeader
        brand={
          <>
            <Icons.ArgusLogo size={16} />
            Argus
          </>
        }
        actions={
          <>
            <SidebarHeaderAction title="New workspace" onClick={onNewWorkspace}>
              <Icons.PlusIcon size={12} />
            </SidebarHeaderAction>
            <SidebarHeaderAction title="Open repo" onClick={onAddRepository}>
              <Icons.FolderIcon size={12} />
            </SidebarHeaderAction>
          </>
        }
      />

      <SidebarNavGroup>
        <SidebarItem
          active={view === "home"}
          leading={<Icons.HomeIcon size={12} />}
          count={data.projects.length}
          onClick={() => onViewChange?.("home")}
        >
          Home
        </SidebarItem>
        <SidebarItem
          active={view === "review"}
          leading={<Icons.MergeIcon size={12} />}
          count={reviewCount}
          onClick={() => onViewChange?.("review")}
        >
          Review queue
        </SidebarItem>
        <SidebarItem
          active={view === "activity"}
          leading={<CommitIcon size={12} />}
          count={runningCount}
          onClick={() => onViewChange?.("activity")}
        >
          Activity
        </SidebarItem>
      </SidebarNavGroup>

      <SidebarScroll>
        <SidebarSection count={totalAgents}>Workspaces</SidebarSection>
        {activeProjects.length === 0 && (
          <div
            style={{
              padding: "8px 10px",
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            No active workspaces.
          </div>
        )}
        {activeProjects.map((p) => {
          const expanded = !collapsed[p.id];

          return (
            <SidebarRepoGroup
              key={p.id}
              name={p.name}
              color={p.accent}
              count={p.agents.length}
              expanded={expanded}
              leading={<Icons.FolderIcon size={11} />}
              onHeaderClick={() => toggle(p.id)}
            >
              {p.agents.map((a) => (
                <SidebarWorkspaceRow
                  key={a.id}
                  name={a.branch}
                  status={agentStatusTone(a.status)}
                  pulse={agentStatusPulse(a.status)}
                  onClick={() =>
                    onOpenWorkspace(a.workspace.id, a.workspace.repo_root)
                  }
                />
              ))}
            </SidebarRepoGroup>
          );
        })}

        {recentProjects.length > 0 && (
          <>
            <SidebarSection count={recentProjects.length}>
              Recent
            </SidebarSection>
            {recentProjects.map((p) => (
              <SidebarRepoGroup
                key={p.id}
                name={p.name}
                color={p.accent}
                expanded={false}
                dim
                leading={<Icons.FolderIcon size={11} />}
                onHeaderClick={() => onOpenProject(p)}
              />
            ))}
          </>
        )}
      </SidebarScroll>

      <SidebarFooter
        leading={<Icons.PlusIcon size={11} />}
        onClick={onAddRepository}
      >
        Add repository
      </SidebarFooter>
    </SidebarNav>
  );
}
