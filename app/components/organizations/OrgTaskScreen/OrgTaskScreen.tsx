import type { OrgTask, OrgTaskMember } from "../../../lib/types";
import { useState } from "react";
import { Button, TextArea } from "@argus/peacock";
import { sendAgentMessage } from "../../../lib/ipc";
import {
  cancelOrgTask,
  setActiveOrgTask,
  useActiveOrgTask,
} from "../../../stores/orgTaskStore";
import { useOrganizations } from "../../../stores/organizationStore";
import { selectWorkspace } from "../../../stores/workspaceStore";
import styles from "./OrgTaskScreen.module.css";

/** Mount-point wrapper — shown when an active OrgTask is selected. */
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
  const [bulkMessage, setBulkMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const elapsedMs = Date.now() - task.created_at;

  const handleCancel = async () => {
    if (!window.confirm("Cancel this task? All running child agents stop.")) {
      return;
    }
    setBusy(true);
    try {
      await cancelOrgTask(task.id);
    } finally {
      setBusy(false);
    }
  };

  const handleBulk = async () => {
    const msg = bulkMessage.trim();
    if (!msg) {
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        task.members
          .filter((m) => m.agent_id && m.status === "running")
          .map((m) =>
            sendAgentMessage(m.agent_id as string, msg).catch(() => {}),
          ),
      );
      setBulkMessage("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>
            {org?.name ?? "Organization"} · Task
          </span>
          <span className={styles.title}>{task.title}</span>
          <span className={styles.meta}>
            {task.status} · started {formatElapsed(elapsedMs)} ago ·{" "}
            {task.members.length} member
            {task.members.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={styles.actions}>
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

        {task.status === "running" && (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              Send follow-up to all running agents
            </div>
            <div className={styles.followUpBar}>
              <TextArea
                rows={2}
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                placeholder="e.g. Please start with the backend schema"
              />
              <Button
                variant="primary"
                onClick={handleBulk}
                disabled={busy || !bulkMessage.trim()}
              >
                Send to all
              </Button>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Members</div>
          <div className={styles.memberList}>
            {task.members.map((m) => (
              <MemberCard key={m.repo_root} member={m} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MemberCard({ member }: { member: OrgTaskMember }) {
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);

  const handleOpen = () => {
    if (!member.workspace_id) {
      return;
    }
    selectWorkspace(member.workspace_id);
    setActiveOrgTask(null);
  };

  const handleSend = async () => {
    if (!member.agent_id || !msg.trim()) {
      return;
    }
    setSending(true);
    try {
      await sendAgentMessage(member.agent_id, msg.trim());
      setMsg("");
      setShowFollowUp(false);
    } catch {
      // Silent — surfaced via agent log.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.memberCard}>
      <div className={styles.memberHead}>
        <div className={styles.memberInfo}>
          <span className={styles.memberName}>
            {basename(member.repo_root)}
          </span>
          <span className={styles.memberRole}>
            {(member.role || "(no role)") + " · " + member.repo_root}
          </span>
        </div>
        <span className={styles.memberStatus} data-status={member.status}>
          {member.status}
        </span>
        <div className={styles.memberActions}>
          <Button
            variant="ghost"
            onClick={handleOpen}
            disabled={!member.workspace_id}
          >
            Open workspace
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowFollowUp((v) => !v)}
            disabled={!member.agent_id || member.status !== "running"}
          >
            Follow-up
          </Button>
        </div>
      </div>

      {member.addendum && (
        <div className={styles.addendum}>Addendum: {member.addendum}</div>
      )}

      {showFollowUp && (
        <div className={styles.followUpRow}>
          <TextArea
            rows={2}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={`Follow-up for ${basename(member.repo_root)}`}
          />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={sending || !msg.trim()}
          >
            Send
          </Button>
        </div>
      )}
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
