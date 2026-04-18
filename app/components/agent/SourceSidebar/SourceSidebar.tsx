import type { SourceView } from "../GitView";
import { Icons, SidebarItem, SidebarNav, SidebarSection } from "@argus/peacock";
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
    <SidebarNav framed className={styles.sidebar}>
      <SidebarSection>Workspace</SidebarSection>
      <SidebarItem
        active={activeView === "working-copy"}
        count={fileCount > 0 ? fileCount : undefined}
        leading={<Icons.WorkingCopyIcon size={13} />}
        onClick={() => onViewChange("working-copy")}
      >
        Working Copy
      </SidebarItem>
      <SidebarItem
        active={activeView === "branch"}
        leading={<Icons.BranchNodesIcon size={13} />}
        onClick={() => onViewChange("branch")}
      >
        Branch
      </SidebarItem>
      <SidebarItem
        active={activeView === "history"}
        leading={<Icons.ClockIcon size={13} />}
        onClick={() => onViewChange("history")}
      >
        History
      </SidebarItem>
      <SidebarItem
        active={activeView === "stashes"}
        leading={<Icons.StashIcon size={13} />}
        onClick={() => onViewChange("stashes")}
      >
        Stashes
      </SidebarItem>
    </SidebarNav>
  );
}
