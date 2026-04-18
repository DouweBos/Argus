import { useCallback, useMemo, useRef, useState } from "react";
import { TitleBar as PeacockTitleBar } from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { listBranches, setWorkspaceBaseBranch } from "../../../lib/ipc";
import { openCommandPalette } from "../../../stores/commandPaletteStore";
import {
  toggleLeftSidebar,
  toggleRightPanel,
} from "../../../stores/layoutStore";
import {
  updateWorkspace,
  useSelectedWorkspaceId,
  useWorkspaces,
} from "../../../stores/workspaceStore";
import { PencilIcon } from "../../shared/Icons";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  const selectedId = useSelectedWorkspaceId();
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () =>
      selectedId ? (workspaces.find((w) => w.id === selectedId) ?? null) : null,
    [selectedId, workspaces],
  );

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

  const projectName = workspace?.repo_root
    ? (workspace.repo_root.split("/").filter(Boolean).pop() ?? null)
    : null;

  const title = workspace ? (
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
  ) : (
    <span className={styles.homeTitle}>Argus · home</span>
  );

  return (
    <PeacockTitleBar
      className={styles.bar}
      showTraffic={false}
      title={title}
      onJump={openCommandPalette}
      onToggleLeft={toggleLeftSidebar}
      onToggleRight={workspace ? toggleRightPanel : undefined}
    />
  );
}
