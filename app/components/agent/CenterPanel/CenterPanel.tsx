import { useMemo } from "react";
import { Chip } from "@argus/peacock";
import {
  setActiveCenterView,
  useActiveCenterView,
} from "../../../stores/editorStore";
import { useOrgTaskForSession } from "../../../stores/orgTaskStore";
import { useSessions } from "../../../stores/sessionStore";
import { EditorPanel } from "../../editor/EditorPanel";
import { HomeScreen } from "../../home/HomeScreen";
import { RunControl } from "../../layout/RunControl";
import { TaskBanner } from "../../organizations/TaskBanner";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
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
          <Chip
            interactive
            className={
              effectiveView === "agents" || effectiveView === "home"
                ? styles.chipActive
                : undefined
            }
            onClick={() => setActiveView("agents")}
          >
            Agents
          </Chip>
          {!isOrgHost && (
            <>
              <Chip
                interactive
                className={
                  effectiveView === "editor" ? styles.chipActive : undefined
                }
                onClick={() => setActiveView("editor")}
              >
                Editor
              </Chip>
              <Chip
                interactive
                className={
                  effectiveView === "git" ? styles.chipActive : undefined
                }
                onClick={() => setActiveView("git")}
              >
                Git
              </Chip>
            </>
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
        {(effectiveView === "agents" || effectiveView === "home") && (
          <AgentView sessionId={sessionId} />
        )}

        {effectiveView === "editor" && <EditorPanel sessionId={sessionId} />}

        {effectiveView === "git" && (
          <GitView
            baseBranch={session?.base_branch}
            branchName={session?.branch}
            repoRoot={session?.repo_root ?? ""}
            sessionId={sessionId}
          />
        )}
      </div>
    </div>
  );
}
