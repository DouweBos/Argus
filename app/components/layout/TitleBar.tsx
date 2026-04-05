import { useState, useCallback, useRef, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { listBranches, setWorkspaceBaseBranch } from "../../lib/ipc";
import { SidebarToggles } from "./SidebarToggles";
import { LogsModal } from "../agent/LogsPanel";
import { LogsIcon, PencilIcon } from "../shared/Icons";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const workspace = useWorkspaceStore((s) =>
    selectedId ? (s.workspaces.find((w) => w.id === selectedId) ?? null) : null,
  );
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);

  const leftVisible = useLayoutStore((s) => s.leftSidebarVisible);
  const leftWidth = useLayoutStore((s) => s.leftPanelWidth);
  const activeToolId = useLayoutStore((s) => s.activeToolId);
  const toolPanelWidth = useLayoutStore((s) => s.toolPanelWidth);

  const [showLogs, setShowLogs] = useState(false);

  // Base-branch picker state
  const [isEditingBase, setIsEditingBase] = useState(false);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openBaseBranchPicker = useCallback(async () => {
    if (!workspace) return;
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
      if (!selectedId) return;
      setIsEditingBase(false);
      try {
        await setWorkspaceBaseBranch(selectedId, branch);
        updateWorkspace(selectedId, { base_branch: branch });
      } catch {
        // ignore
      }
    },
    [selectedId, updateWorkspace],
  );

  // Close picker when clicking outside
  useEffect(() => {
    if (!isEditingBase) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsEditingBase(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isEditingBase]);

  const canEditBase = workspace?.kind === "worktree";

  // Derive project name from repo_root basename
  const projectName = workspace?.repo_root
    ? workspace.repo_root.split("/").filter(Boolean).pop() ?? null
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
              <div className={styles.baseBranchGroup} ref={pickerRef}>
                <button
                  className={`${styles.baseBranchLabel} ${canEditBase ? styles.baseBranchEditable : ""}`}
                  onClick={canEditBase ? openBaseBranchPicker : undefined}
                  title={canEditBase ? "Change base branch" : undefined}
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
      >
        <div className={styles.rightActions}>
          <button
            className={styles.iconButton}
            onClick={() => setShowLogs(true)}
            title="View logs"
          >
            <LogsIcon />
          </button>
        </div>
      </div>

      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
    </div>
  );
}
