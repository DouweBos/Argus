import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { AgentView } from "./AgentView";
import { GitView } from "./GitView";
import { EditorPanel } from "../editor/EditorPanel";
import { StagehandLogo } from "../shared/Icons";
import styles from "./CenterPanel.module.css";

type ActiveView = "agents" | "editor" | "git";

interface CenterPanelProps {
  workspaceId: null | string;
}

export function CenterPanel({ workspaceId }: CenterPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    workspaceId
      ? (s.workspaces.find((w) => w.id === workspaceId) ?? null)
      : null,
  );

  // View switcher state
  const [activeView, setActiveView] = useState<ActiveView>("agents");

  if (!workspaceId || !workspace) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyContent}>
          <StagehandLogo className={styles.logo} />
          <h2 className={styles.emptyTitle}>Stagehand</h2>
          <p className={styles.emptySubtitle}>
            Select or create a workspace to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <button
            className={`${styles.viewTab} ${activeView === "agents" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("agents")}
          >
            Agents
          </button>
          <button
            className={`${styles.viewTab} ${activeView === "editor" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("editor")}
          >
            Editor
          </button>
          <button
            className={`${styles.viewTab} ${activeView === "git" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("git")}
          >
            Git
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeView === "agents" && <AgentView workspaceId={workspaceId} />}

      {activeView === "editor" && <EditorPanel workspaceId={workspaceId} />}

      {activeView === "git" && (
        <GitView
          workspaceId={workspaceId}
          baseBranch={workspace?.base_branch}
          branchName={workspace?.branch}
          repoRoot={workspace?.repo_root ?? ""}
        />
      )}
    </div>
  );
}
