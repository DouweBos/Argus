import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { TitleBar as PeacockTitleBar } from "@argus/peacock";
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
import { NavigationButtons } from "../NavigationButtons";
import { RunControl } from "../RunControl";
import styles from "./TitleBar.module.css";

const ROUTE_TITLES: Record<string, string> = {
  "": "Home",
  agents: "Agents",
  devices: "Devices",
  organizations: "Organizations",
  "review-queue": "Review queue",
  activity: "Activity",
  notifications: "Notifications",
};

function routeTitle(pathname: string): string {
  const segment = pathname.replace(/\/+$/, "").split("/")[1] ?? "";

  return ROUTE_TITLES[segment] ?? "Home";
}

export function TitleBar() {
  const selectedId = useSelectedSessionId();
  const sessions = useSessions();
  const location = useLocation();
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

  const canEditBase = session?.kind === "worktree";

  const projectName = session?.repo_root
    ? (session.repo_root.split("/").filter(Boolean).pop() ?? null)
    : null;

  const title = session ? (
    <div className={styles.branchInfo}>
      {projectName && (
        <>
          <span className={styles.projectName}>{projectName}</span>
          <span className={styles.separator}>/</span>
        </>
      )}
      <span className={styles.branchLabel}>{session.branch}</span>
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
    <span className={styles.homeTitle}>
      Argus · {routeTitle(location.pathname)}
    </span>
  );

  return (
    <PeacockTitleBar
      className={styles.bar}
      showTraffic={false}
      title={title}
      jumpHotkey={shortcutKeys("command-palette")}
      onJump={openCommandPalette}
      onToggleLeft={toggleLeftSidebar}
      onToggleRight={session ? toggleRightPanel : undefined}
      left={<NavigationButtons />}
      right={
        session ? (
          <RunControl key={session.id} sessionId={session.id} />
        ) : undefined
      }
    />
  );
}
