import { TerminalTabs } from "../../runtime/TerminalTabs";
import styles from "./TerminalTool.module.css";

interface TerminalToolProps {
  workspaceId: null | string;
}

export function TerminalTool({ workspaceId }: TerminalToolProps) {
  if (!workspaceId) {
    return (
      <div className={styles.empty}>
        <p>Select a workspace to open terminals.</p>
      </div>
    );
  }

  return <TerminalTabs workspaceId={workspaceId} />;
}
