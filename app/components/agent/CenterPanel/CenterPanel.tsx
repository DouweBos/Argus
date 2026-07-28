import { useMemo } from "react";
import { Chip, EmptyState, Icons } from "@argus/peacock";
import {
  setActiveCenterView,
  useActiveCenterView,
} from "../../../stores/editorStore";
import { useOrgTaskForSession } from "../../../stores/orgTaskStore";
import { useSessions } from "../../../stores/sessionStore";
import { HomeScreen } from "../../home/HomeScreen";
import { RunControl } from "../../layout/RunControl";
import { TaskBanner } from "../../organizations/TaskBanner";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
import { HomePanel } from "../HomePanel";
import styles from "./CenterPanel.module.css";

interface CenterPanelProps {
  sessionId: string | null;
}

export function CenterPanel({ sessionId }: CenterPanelProps) {
  const sessions = useSessions();
  const session = useMemo(
    () =>
      sessionId ? (sessions.find((w) => w.id === sessionId) ?? null) : null,
    [sessionId, sessions],
  );

  const activeView = useActiveCenterView();
  const setActiveView = setActiveCenterView;

  const orgTask = useOrgTaskForSession(sessionId);

  if (!sessionId || !session) {
    return <HomeScreen />;
  }

  // Org-host sessions are pure agent orchestrators — they have no worktree,
  // no file editor, no git view. Force the Agents view and hide the other
  // tabs.
  const isOrgHost = session.kind === "org_host";
  const effectiveView = isOrgHost ? "agents" : activeView;

  return (
    <div className={styles.panel}>
      {orgTask && <TaskBanner task={orgTask} />}
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          {!isOrgHost && (
            <Chip
              interactive
              leading={<Icons.HomeIcon size={12} />}
              className={
                effectiveView === "home" ? styles.chipActive : undefined
              }
              onClick={() => setActiveView("home")}
            >
              Home
            </Chip>
          )}
          <Chip
            interactive
            leading={<Icons.AgentIcon size={12} />}
            className={
              effectiveView === "agents" ? styles.chipActive : undefined
            }
            onClick={() => setActiveView("agents")}
          >
            Agents
          </Chip>
          {!isOrgHost && (
            <Chip
              interactive
              leading={<Icons.BranchIcon size={12} />}
              className={
                effectiveView === "git" ? styles.chipActive : undefined
              }
              onClick={() => setActiveView("git")}
            >
              Git
            </Chip>
          )}
        </div>
        {!isOrgHost && (
          <div className={styles.runControl}>
            <RunControl key={sessionId} sessionId={sessionId} />
          </div>
        )}
      </div>

      {/* Content area */}
      <div className={styles.body}>
        {effectiveView === "home" && (
          <HomePanel key={sessionId} sessionId={sessionId} />
        )}

        {effectiveView === "agents" && <AgentView sessionId={sessionId} />}

        {effectiveView === "git" &&
          (session.status === "initializing" ? (
            <EmptyState
              icon={<Icons.BranchIcon size={20} />}
              title="Setting up worktree…"
              body="The git view becomes available once the session finishes initializing."
            />
          ) : (
            <GitView
              baseBranch={session?.base_branch}
              branchName={session?.branch}
              repoRoot={session?.repo_root ?? ""}
              scope={session?.kind === "project_root" ? "project" : "session"}
              sessionId={sessionId}
            />
          ))}
      </div>
    </div>
  );
}
