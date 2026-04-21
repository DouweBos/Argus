import type { AgentStatus, OrgTask } from "../../../lib/types";
import { useMemo, useState } from "react";
import { Button } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "./TaskSidePanel.module.css";

interface Props {
  task: OrgTask;
}

export function TaskSidePanel({ task }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const agents = useAgentsRecord();
  const sessions = useSessions();

  const children = useMemo<AgentStatus[]>(() => {
    if (!task.host_agent_id) {
      return [];
    }

    return Object.values(agents).filter(
      (a) => a.parent_agent_id === task.host_agent_id,
    );
  }, [agents, task.host_agent_id]);

  if (collapsed) {
    return (
      <aside className={`${styles.panel} ${styles.collapsed}`}>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setCollapsed(false)}
          title="Expand task panel"
        >
          ›
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Task</span>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setCollapsed(true)}
          title="Collapse task panel"
        >
          ‹
        </button>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Shared prompt</div>
        <div className={styles.promptBox}>{task.prompt}</div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Scope</div>
        <div className={styles.list}>
          {task.scope.map((entry) => (
            <div key={entry.repo_root} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{basename(entry.repo_root)}</span>
              </div>
              <span className={styles.role}>
                {entry.role || "(no role)"} · {entry.repo_root}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>Child agents</div>
        {children.length === 0 ? (
          <div className={styles.empty}>
            The host hasn&apos;t spawned any child agents yet.
          </div>
        ) : (
          <div className={styles.list}>
            {children.map((child) => {
              const ws = sessions.find((s) => s.id === child.session_id);
              const repoRoot = ws?.repo_root ?? "(unknown)";

              return (
                <div key={child.agent_id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.name}>{basename(repoRoot)}</span>
                    <span className={styles.status} data-status={child.status}>
                      {child.status}
                    </span>
                  </div>
                  <span className={styles.role}>{repoRoot}</span>
                  <Button
                    variant="ghost"
                    className={styles.openBtn}
                    onClick={() => selectSession(child.session_id)}
                  >
                    Open session
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
