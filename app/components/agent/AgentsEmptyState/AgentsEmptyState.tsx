import { IconBadge, Icons } from "@argus/peacock";
import { StartComposer } from "../StartComposer";
import styles from "./AgentsEmptyState.module.css";

interface AgentsEmptyStateProps {
  sessionId: string;
}

export function AgentsEmptyState({ sessionId }: AgentsEmptyStateProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <IconBadge size="lg" tone="neutral">
            <Icons.AgentIcon size={20} />
          </IconBadge>
          <h1 className={styles.title}>Start an agent</h1>
          <p className={styles.body}>
            Describe what you want done. Run it here, or in a new worktree of
            its own — open more tabs to run agents in parallel.
          </p>
        </div>
        <StartComposer autoFocus sessionId={sessionId} />
      </div>
    </div>
  );
}
