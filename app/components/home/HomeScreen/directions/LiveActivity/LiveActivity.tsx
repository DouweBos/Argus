import type { HomeAgent, HomeData, HomeProject } from "../../useHomeData";
import type { CSSProperties } from "react";
import {
  Button,
  FeedItem,
  Icons,
  MiniStat,
  QuickCard,
  StatusDot,
  agentStatusPulse,
  agentStatusTone,
  type AgentStatus as PeacockAgentStatus,
} from "@argus/peacock";
import { HOME_SHORTCUTS } from "../../homeContent";
import styles from "./LiveActivity.module.css";

export interface LiveActivityProps {
  data: HomeData & { formatLastOpened: (ms: number) => string };
  onAddRepository: () => void;
  onNewWorkspace: () => void;
  onOpenProject: (proj: HomeProject) => void;
  onOpenWorkspace: (workspaceId: string, repoPath: string) => void;
}

/**
 * No historical activity log is available from the backend yet, so the feed
 * surfaces the current active agents as "Now" items. As soon as an event log
 * exists this falls through to FeedItems rendered from it.
 */
export function LiveActivity({
  data,
  onAddRepository,
  onNewWorkspace,
  onOpenProject,
  onOpenWorkspace,
}: LiveActivityProps) {
  const { projects, activeAgents, stats } = data;

  return (
    <div className={styles.wrap}>
      <div className={styles.rail}>
        <div className={styles.railHead}>
          <div className={styles.title}>Projects</div>
          <div className={styles.sub}>
            {projects.length} repos ·{" "}
            {projects.filter((p) => p.agents.length > 0).length} active
          </div>
        </div>
        <div className={styles.railList}>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.railItem}
              style={{ ["--item-accent" as string]: p.accent } as CSSProperties}
              onClick={() => onOpenProject(p)}
            >
              <div className={styles.spine} />
              <div className={styles.glyph}>
                <Icons.FolderIcon size={14} />
              </div>
              <div className={styles.railBody}>
                <div className={styles.nm}>{p.name}</div>
                <div className={styles.path}>
                  {p.workspaces[0]?.branch ?? p.path}
                </div>
              </div>
              <div className={styles.dots}>
                {p.agents.slice(0, 4).map((a, i) => (
                  <StatusDot
                    key={`${a.id}-${i}`}
                    tone={agentStatusTone(a.status)}
                    pulse={agentStatusPulse(a.status)}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className={styles.railFooter}>
          <Button
            variant="ghost"
            size="sm"
            leading={<Icons.PlusIcon size={11} />}
            onClick={onAddRepository}
            style={{ flex: 1, justifyContent: "center" }}
          >
            Open repo
          </Button>
        </div>
      </div>

      <div className={styles.center}>
        <div className={styles.header}>
          <Icons.ArgusLogo size={32} />
          <div className={styles.hdText}>
            <h1>Welcome back</h1>
            <div className={styles.tag}>
              {stats.agentsRunning} agents running · {stats.workspaces}{" "}
              workspaces · {stats.projects} repos
            </div>
          </div>
          {stats.agentsRunning > 0 && (
            <div className={styles.pulseBar}>
              <StatusDot tone="success" pulse /> live
            </div>
          )}
        </div>

        <div className={styles.feed}>
          {activeAgents.length === 0 ? (
            <div className={styles.emptyCenter}>
              No activity yet. Start an agent in a workspace to see its tool
              calls here.
            </div>
          ) : (
            <FeedSection
              title="Now"
              agents={activeAgents}
              onOpenWorkspace={onOpenWorkspace}
            />
          )}
        </div>
      </div>

      <div className={styles.right}>
        <QuickCard heading="Today at a glance">
          <MiniStat label="Agents running" value={stats.agentsRunning} accent />
          <MiniStat label="Idle agents" value={stats.agentsIdle} />
          <MiniStat label="Workspaces" value={stats.workspaces} />
          <MiniStat label="Repos" value={stats.projects} />
        </QuickCard>
        <QuickCard heading="Shortcuts">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {HOME_SHORTCUTS.map((s) => (
              <MiniStat key={s.label} label={s.label} value={s.keys.join("")} />
            ))}
          </div>
        </QuickCard>
        <QuickCard heading="Quick actions">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Button
              variant="primary"
              leading={<Icons.PlusIcon size={11} />}
              onClick={onNewWorkspace}
              style={{ justifyContent: "center" }}
            >
              New workspace
            </Button>
            <Button
              variant="ghost"
              leading={<Icons.FolderIcon size={11} />}
              onClick={onAddRepository}
              style={{ justifyContent: "center" }}
            >
              Open repo
            </Button>
          </div>
        </QuickCard>
      </div>
    </div>
  );
}

function agentMeta(status: PeacockAgentStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "pending":
      return "waiting for approval";
    case "error":
      return "blocked";
    case "done":
      return "stopped";
    default:
      return "idle";
  }
}

function FeedSection({
  title,
  agents,
  onOpenWorkspace,
}: {
  agents: HomeAgent[];
  onOpenWorkspace: (workspaceId: string, repoPath: string) => void;
  title: string;
}) {
  return (
    <div className={styles.feedSection}>
      <div className={styles.feedSectionHead}>
        <span className={styles.tstamp}>{title}</span>
        <span className={styles.line} />
        <span className={styles.tstamp} style={{ opacity: 0.5 }}>
          {agents.length} agents
        </span>
      </div>
      {agents.map((a) => (
        <FeedItem
          key={a.id}
          kind="tool_call"
          status={a.status}
          project={basename(a.workspace.repo_root)}
          agent={a.branch}
          text={agentMeta(a.status)}
          mono
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
          onClick={() => onOpenWorkspace(a.workspace.id, a.workspace.repo_root)}
        />
      ))}
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
