import { useCallback, useMemo, useRef, useState } from "react";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { listBranches, setWorkspaceBaseBranch } from "../../../lib/ipc";
import {
  useActiveToolId,
  useLeftPanelWidth,
  useLeftSidebarVisible,
  useToolPanelWidth,
} from "../../../stores/layoutStore";
import {
  updateWorkspace,
  useSelectedWorkspaceId,
  useWorkspaces,
} from "../../../stores/workspaceStore";
import { PencilIcon } from "../../shared/Icons";
import { SidebarToggles } from "../SidebarToggles";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  const selectedId = useSelectedWorkspaceId();
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      selectedId ? (workspaces.find((w) => w.id === selectedId) ?? null) : null,
    [selectedId, workspaces],
  );

  const leftVisible = useLeftSidebarVisible();
  const leftWidth = useLeftPanelWidth();
  const activeToolId = useActiveToolId();
  const toolPanelWidth = useToolPanelWidth();

  // Base-branch picker state
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openBaseBranchPicker = useCallback(async () => {
    if (!workspace) {
      return;
    }
    try {
      const branches = await listBranches(workspace.repo_root);
      setBranchOptions(branches);
      setIsEditingBase(true);
    } catch {
      // ignore
    }
  }, [workspace]);

  const selectBaseBranch = useCallback(
    async (branch: string) => {
      if (!selectedId) {
        return;
      }
      setIsEditingBase(false);
      try {
        await setWorkspaceBaseBranch(selectedId, branch);
        updateWorkspace(selectedId, { base_branch: branch });
      } catch {
        // ignore
      }
    },
    [selectedId],
  );

  useOutsideClick(pickerRef, isEditingBase, () => setIsEditingBase(false));

  const canEditBase = workspace?.kind === "worktree";

  // Derive project name from repo_root basename
  const projectName = workspace?.repo_root
    ? (workspace.repo_root.split("/").filter(Boolean).pop() ?? null)
    : null;

  return (
    <div className={styles.titleBar}>
      {/* Left section — matches left panel width, holds traffic light space + toggles */}
      <div
        className={styles.leftSection}
        style={leftVisible ? { width: `${leftWidth * 100}%` } : undefined}
      >
        <SidebarToggles />
      </div>

      {/* Center section — workspace branch info */}
      <div className={styles.centerSection}>
        {workspace && (
          <div className={styles.branchInfo}>
            {projectName && (
              <>
                <span className={styles.projectName}>{projectName}</span>
                <span className={styles.separator}>/</span>
              </>
            )}
            <span className={styles.branchLabel}>{workspace.branch}</span>
            {workspace.base_branch && (
              <div ref={pickerRef} className={styles.baseBranchGroup}>
                <button
                  className={`${styles.baseBranchLabel} ${canEditBase ? styles.baseBranchEditable : ""}`}
                  title={canEditBase ? "Change base branch" : undefined}
                  onClick={canEditBase ? openBaseBranchPicker : undefined}
                >
                  &rarr; {workspace.base_branch}
                  {canEditBase && (
                    <span className={styles.editIcon}>
                      <PencilIcon />
                    </span>
                  )}
                </button>
                {isEditingBase && (
                  <div className={styles.branchPicker}>
                    {branchOptions.map((b) => (
                      <button
                        key={b}
                        className={`${styles.branchItem} ${b === workspace.base_branch ? styles.branchItemActive : ""}`}
                        onClick={() => selectBaseBranch(b)}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {workspace.description && (
              <span className={styles.descriptionLabel}>
                &mdash; {workspace.description}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right section — matches tool rail + optional tool panel width */}
      <div
        className={styles.rightSection}
        style={{
          width: activeToolId
            ? `calc(48px + ${toolPanelWidth * 100}%)`
            : "48px",
        }}
      />
    </div>
  );
}
