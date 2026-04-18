import type { SourceView } from "../GitView";
import {
  BranchNodesIcon,
  ClockIcon,
  StashIcon,
  WorkingCopyIcon,
} from "../../shared/Icons";
import styles from "./SourceSidebar.module.css";

interface SourceSidebarProps {
  activeView: SourceView;
  fileCount: number;
  onViewChange: (view: SourceView) => void;
}

export function SourceSidebar({
  activeView,
  onViewChange,
  fileCount,
}: SourceSidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>Workspace</div>
        <button
          className={`${styles.navItem} ${activeView === "working-copy" ? styles.navItemActive : ""}`}
          onClick={() => onViewChange("working-copy")}
        >
          <WorkingCopyIcon size={13} />
          <span className={styles.navLabel}>Working Copy</span>
          <span className={styles.badge}>{fileCount}</span>
        </button>
        <button
          className={`${styles.navItem} ${activeView === "branch" ? styles.navItemActive : ""}`}
          onClick={() => onViewChange("branch")}
        >
          <BranchNodesIcon size={13} />
          <span className={styles.navLabel}>Branch</span>
        </button>
        <button
          className={`${styles.navItem} ${activeView === "history" ? styles.navItemActive : ""}`}
          onClick={() => onViewChange("history")}
        >
          <ClockIcon size={13} />
          <span className={styles.navLabel}>History</span>
        </button>
        <button
          className={`${styles.navItem} ${activeView === "stashes" ? styles.navItemActive : ""}`}
          onClick={() => onViewChange("stashes")}
        >
          <StashIcon size={13} />
          <span className={styles.navLabel}>Stashes</span>
        </button>
      </div>
    </div>
  );
}
