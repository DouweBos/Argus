import { useMemo } from "react";
import { Chip, EmptyHome } from "@argus/peacock";
import {
  setActiveCenterView,
  useActiveCenterView,
} from "../../../stores/editorStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { EditorPanel } from "../../editor/EditorPanel";
import { AgentView } from "../AgentView";
import { GitView } from "../GitView";
import styles from "./CenterPanel.module.css";

interface CenterPanelProps {
  workspaceId: string | null;
}

export function CenterPanel({ workspaceId }: CenterPanelProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      workspaceId
        ? (workspaces.find((w) => w.id === workspaceId) ?? null)
        : null,
    [workspaceId, workspaces],
  );

  const activeView = useActiveCenterView();
  const setActiveView = setActiveCenterView;

  if (!workspaceId || !workspace) {
    return (
      <div className={styles.empty}>
        <EmptyHome
          title="Argus"
          tagline="select or create a workspace to begin"
        />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <Chip
            interactive
            className={
              activeView === "agents" || activeView === "home"
                ? styles.chipActive
                : undefined
            }
            onClick={() => setActiveView("agents")}
          >
            Agents
          </Chip>
          <Chip
            interactive
            className={activeView === "editor" ? styles.chipActive : undefined}
            onClick={() => setActiveView("editor")}
          >
            Editor
          </Chip>
          <Chip
            interactive
            className={activeView === "git" ? styles.chipActive : undefined}
            onClick={() => setActiveView("git")}
          >
            Git
          </Chip>
        </div>
      </div>

      {/* Content area */}
      {(activeView === "agents" || activeView === "home") && (
        <AgentView workspaceId={workspaceId} />
      )}

      {activeView === "editor" && <EditorPanel workspaceId={workspaceId} />}

      {activeView === "git" && (
        <GitView
          baseBranch={workspace?.base_branch}
          branchName={workspace?.branch}
          repoRoot={workspace?.repo_root ?? ""}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}
