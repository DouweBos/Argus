import { useCallback, useMemo, useRef, useState } from "react";
import { Breadcrumbs, TitleBar as PeacockTitleBar } from "@argus/peacock";
import { useIsFullscreen } from "../../../hooks/useIsFullscreen";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { listBranches, setSessionBaseBranch } from "../../../lib/ipc";
import { shortcutKeys } from "../../../lib/shortcuts";
import { openCommandPalette } from "../../../stores/commandPaletteStore";
import {
  toggleLeftSidebar,
  toggleRightPanel,
} from "../../../stores/layoutStore";
import {
  updateSession,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";
import { PencilIcon } from "../../shared/Icons";
import { SessionReferenceChips } from "../../shared/SessionReferenceChips/SessionReferenceChips";
import { ConnectionPicker } from "../ConnectionPicker";
import { NavigationButtons } from "../NavigationButtons";
import styles from "./TitleBar.module.css";
import { useBreadcrumbs } from "./useBreadcrumbs";

export function TitleBar() {
  const selectedId = useSelectedSessionId();
  const sessions = useSessions();
  const isFullscreen = useIsFullscreen();
  const crumbs = useBreadcrumbs();
  const session = useMemo(
    () =>
      selectedId ? (sessions.find((w) => w.id === selectedId) ?? null) : null,
    [selectedId, sessions],
  );

  const [isEditingBase, setIsEditingBase] = useState(false);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openBaseBranchPicker = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      const branches = await listBranches(session.repo_root);
      setBranchOptions(branches);
      setIsEditingBase(true);
    } catch {
      // ignore
    }
  }, [session]);

  const selectBaseBranch = useCallback(
    async (branch: string) => {
      if (!selectedId) {
        return;
      }
      setIsEditingBase(false);
      try {
        await setSessionBaseBranch(selectedId, branch);
        updateSession(selectedId, { base_branch: branch });
      } catch {
        // ignore
      }
    },
    [selectedId],
  );

  useOutsideClick(pickerRef, isEditingBase, () => setIsEditingBase(false));

  // An automation's host session belongs under its run, not beside your own
  // worktrees, so it gets the trail instead of the branch line.
  // A scratch pad has no branch either, so it takes the trail too.
  const automationHosted =
    session?.kind === "automation_host" || session?.kind === "scratch_pad";
  const canEditBase = session?.kind === "worktree";
  const projectName = session?.repo_root
    ? (session.repo_root.split("/").filter(Boolean).pop() ?? null)
    : null;

  const title =
    session && !automationHosted ? (
      <div className={styles.branchInfo}>
        {projectName && (
          <>
            <span className={styles.projectName}>{projectName}</span>
            <span className={styles.separator}>/</span>
          </>
        )}
        <span className={styles.branchLabel}>{session.branch}</span>
        <SessionReferenceChips session={session} />
        {session.base_branch && (
          <div ref={pickerRef} className={styles.baseBranchGroup}>
            <button
              className={`${styles.baseBranchLabel} ${canEditBase ? styles.baseBranchEditable : ""}`}
              title={canEditBase ? "Change base branch" : undefined}
              onClick={canEditBase ? openBaseBranchPicker : undefined}
            >
              &rarr; {session.base_branch}
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
                    className={`${styles.branchItem} ${b === session.base_branch ? styles.branchItemActive : ""}`}
                    onClick={() => selectBaseBranch(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    ) : (
      <Breadcrumbs items={crumbs} className={styles.homeTitle} />
    );

  return (
    <PeacockTitleBar
      className={`${styles.bar} ${isFullscreen ? styles.barFullscreen : ""}`}
      showTraffic={false}
      title={title}
      jumpHotkey={shortcutKeys("command-palette")}
      onJump={openCommandPalette}
      onToggleLeft={toggleLeftSidebar}
      onToggleRight={session ? toggleRightPanel : undefined}
      left={<NavigationButtons />}
      right={<ConnectionPicker />}
    />
  );
}
