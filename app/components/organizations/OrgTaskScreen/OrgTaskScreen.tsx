import type {
  AgentStatus,
  OrgTask,
  OrgTaskScopeEntry,
} from "../../../lib/types";
import { useMemo, useState } from "react";
import { Button, TextArea } from "@argus/peacock";
import { sendAgentMessage } from "../../../lib/ipc";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  cancelOrgTask,
  setActiveOrgTask,
  useActiveOrgTask,
} from "../../../stores/orgTaskStore";
import { useOrganizations } from "../../../stores/organizationStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "./OrgTaskScreen.module.css";

export function OrgTaskOverlay() {
  const task = useActiveOrgTask();
  if (!task) {
    return null;
  }

  return <OrgTaskScreen task={task} />;
}

export function OrgTaskScreen({ task }: { task: OrgTask }) {
  const orgs = useOrganizations();
  const org = orgs.find((o) => o.id === task.organization_id);
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);

  const agents = useAgentsRecord();
  const sessions = useSessions();

  const elapsedMs = Date.now() - task.created_at;

  const children = useMemo<AgentStatus[]>(() => {
    if (!task.host_agent_id) {
      return [];
    }

    return Object.values(agents).filter(
      (a) => a.parent_agent_id === task.host_agent_id,
    );
  }, [agents, task.host_agent_id]);

  const hostStatus: string = task.host_agent_id
    ? (agents[task.host_agent_id]?.status ?? task.status)
    : task.status;

  const handleCancel = async () => {
    if (
      !window.confirm(
        "Cancel this task? The host agent stops; any child agents keep running.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await cancelOrgTask(task.id);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenHost = () => {
    if (!task.host_session_id) {
      return;
    }
    selectSession(task.host_session_id);
    setActiveOrgTask(null);
  };

  const handleFollowUp = async () => {
    const msg = followUp.trim();
    if (!msg || !task.host_agent_id) {
      return;
    }
    setBusy(true);
    try {
      await sendAgentMessage(task.host_agent_id, msg);
      setFollowUp("");
    } catch {
      // Surfaced via agent log.
    } finally {
      setBusy(false);
    }
  };

  const hostSessionReady = Boolean(task.host_session_id);

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>
            {org?.name ?? "Organization"} · Task
          </span>
          <span className={styles.title}>{task.title}</span>
          <span className={styles.meta}>
            {task.status} · host {hostStatus} · started{" "}
            {formatElapsed(elapsedMs)} ago · {task.scope.length} repo
            {task.scope.length === 1 ? "" : "s"} in scope
          </span>
        </div>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={handleOpenHost}
            disabled={!hostSessionReady}
          >
            Open host session
          </Button>
          <Button variant="ghost" onClick={() => setActiveOrgTask(null)}>
            Close
          </Button>
          {task.status === "running" && (
            <Button variant="ghost" onClick={handleCancel} disabled={busy}>
              Cancel task
            </Button>
          )}
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Shared prompt</div>
          <div className={styles.promptBox}>{task.prompt}</div>
        </section>

        {task.host_agent_id && task.status === "running" && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>Follow-up to host</div>
            <div className={styles.followUpBar}>
              <TextArea
                rows={2}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="Send a follow-up message to the host agent"
              />
              <Button
                variant="primary"
                onClick={handleFollowUp}
                disabled={busy || !followUp.trim()}
              >
                Send
              </Button>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Scope</div>
          <div className={styles.memberList}>
            {task.scope.map((s) => (
              <ScopeRow key={s.repo_root} entry={s} />
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Child agents</div>
          {children.length === 0 ? (
            <div className={styles.meta}>
              The host hasn&apos;t spawned any child agents yet.
            </div>
          ) : (
            <div className={styles.memberList}>
              {children.map((c) => {
                const ws = sessions.find((w) => w.id === c.session_id);
                const repoRoot = ws?.repo_root ?? "(unknown)";
                const label = basename(repoRoot);

                return (
                  <div key={c.agent_id} className={styles.memberCard}>
                    <div className={styles.memberHead}>
                      <div className={styles.memberInfo}>
                        <span className={styles.memberName}>{label}</span>
                        <span className={styles.memberRole}>{repoRoot}</span>
                      </div>
                      <span
                        className={styles.memberStatus}
                        data-status={c.status}
                      >
                        {c.status}
                      </span>
                      <div className={styles.memberActions}>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            selectSession(c.session_id);
                            setActiveOrgTask(null);
                          }}
                        >
                          Open session
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ScopeRow({ entry }: { entry: OrgTaskScopeEntry }) {
  return (
    <div className={styles.memberCard}>
      <div className={styles.memberHead}>
        <div className={styles.memberInfo}>
          <span className={styles.memberName}>{basename(entry.repo_root)}</span>
          <span className={styles.memberRole}>
            {(entry.role || "(no role)") + " · " + entry.repo_root}
          </span>
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }

  return `${Math.floor(hr / 24)}d`;
}
