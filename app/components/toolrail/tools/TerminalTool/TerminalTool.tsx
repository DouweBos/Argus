import { TerminalTabs } from "../../../runtime/Terminal";
import styles from "./TerminalTool.module.css";

interface TerminalToolProps {
  sessionId: string | null;
}

export function TerminalTool({ sessionId }: TerminalToolProps) {
  if (!sessionId) {
    return (
      <div className={styles.empty}>
        <p>Select a session to open terminals.</p>
      </div>
    );
  }

  return <TerminalTabs sessionId={sessionId} />;
}
