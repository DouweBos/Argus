import type { SourceView } from "./GitView";
import styles from "./SourceSidebar.module.css";

interface SourceSidebarProps {
  activeView: SourceView;
  fileCount: number;
  onViewChange: (view: SourceView) => void;
}

function WorkingCopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0H4zm5.586 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414a1 1 0 0 0-.293-.707L9.586 1z" />
      <path d="M6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
}

function BranchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6.5a.5.5 0 0 1-.5.5H9.207l-1.854 1.854a.5.5 0 0 1-.353.146H5v2.628a2.25 2.25 0 1 1-1 0V4.372a2.25 2.25 0 1 1 1 0V8h1.793l1.854-1.854A.5.5 0 0 1 9 6h2.75V5.372A2.251 2.251 0 0 1 9.5 3.25zM4.5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0zM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
    </svg>
  );
}

function HistoryIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71V3.5z" />
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
    </svg>
  );
}

function StashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6h-11A1.5 1.5 0 0 1 1 4.5v-1zM2.5 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11z" />
      <path d="M3 7v7.5A1.5 1.5 0 0 0 4.5 16h7a1.5 1.5 0 0 0 1.5-1.5V7H3zm2 1.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z" />
    </svg>
  );
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
          <BranchIcon size={13} />
          <span className={styles.navLabel}>Branch</span>
        </button>
        <button
          className={`${styles.navItem} ${activeView === "history" ? styles.navItemActive : ""}`}
          onClick={() => onViewChange("history")}
        >
          <HistoryIcon size={13} />
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
