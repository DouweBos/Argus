import type { AgentStatus, OrgTask } from "../../../lib/types";
import { useMemo } from "react";
import { Button, Icons, SectionPanel } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { MergeAction } from "../../runtime/MergeBar";
import styles from "./TaskWidgets.module.css";

interface Props {
  task: OrgTask;
}

export function TaskWidgets({ task }: Props) {
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

  return (
    <>
      <SectionPanel title="Shared prompt" meta="sent to every child agent">
        <div className={styles.promptBox}>{task.prompt}</div>
      </SectionPanel>

      <SectionPanel
        title="Scope"
        meta={`${task.scope.length} repo${task.scope.length === 1 ? "" : "s"}`}
      >
        <div className={styles.list}>
          {task.scope.map((entry) => (
            <div key={entry.repo_root} className={styles.memberRow}>
              <span className={styles.memberIcon}>
                <Icons.RepoIcon size={12} />
              </span>
              <div className={styles.memberBody}>
                <span className={styles.memberName}>
                  {basename(entry.repo_root)}
                </span>
                {entry.role && (
                  <span className={styles.memberRole}>{entry.role}</span>
                )}
                <span className={styles.memberPath}>{entry.repo_root}</span>
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel
        title="Child agents"
        meta={children.length === 0 ? "none yet" : `${children.length} spawned`}
      >
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
                <div key={child.agent_id} className={styles.childRow}>
                  <div className={styles.childHead}>
                    <span className={styles.childName}>
                      {basename(repoRoot)}
                    </span>
                    <span
                      className={styles.childStatus}
                      data-status={child.status}
                    >
                      {child.status}
                    </span>
                  </div>
                  <span className={styles.childPath}>{repoRoot}</span>
                  <Button
                    variant="ghost"
                    className={styles.openBtn}
                    onClick={() => selectSession(child.session_id)}
                  >
                    Open session
                  </Button>
                  <MergeAction sessionId={child.session_id} />
                </div>
              );
            })}
          </div>
        )}
      </SectionPanel>
    </>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
