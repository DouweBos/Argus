import type { OrgTask } from "../../../lib/types";
import { useState } from "react";
import { Button } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import { cancelOrgTask, deleteOrgTask } from "../../../stores/orgTaskStore";
import { useOrganizations } from "../../../stores/organizationStore";
import { selectSession } from "../../../stores/sessionStore";
import styles from "./TaskBanner.module.css";

interface Props {
  task: OrgTask;
}

export function TaskBanner({ task }: Props) {
  const orgs = useOrganizations();
  const org = orgs.find((o) => o.id === task.organization_id);
  const agents = useAgentsRecord();
  const [busy, setBusy] = useState(false);

  const hostAgent = task.host_agent_id ? agents[task.host_agent_id] : null;
  const hostStatus: string = hostAgent?.status ?? task.status;

  // Offer a hard delete when the task is in a terminal/broken state. Also
  // offer it when `status` is `running` but the host agent record is missing
  // — that's the "stuck task" case after a prior crash.
  const isRunning = task.status === "running";
  const hostMissing = Boolean(
    task.host_agent_id && !agents[task.host_agent_id],
  );
  const canDelete =
    task.status === "failed" ||
    task.status === "cancelled" ||
    task.status === "completed" ||
    (isRunning && hostMissing);

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

  const handleDelete = async () => {
    if (!window.confirm("Delete this task? This can't be undone.")) {
      return;
    }
    setBusy(true);
    try {
      await deleteOrgTask(task.id);
      selectSession(null);
    } finally {
      setBusy(false);
    }
  };

  const elapsedMs = Date.now() - task.created_at;

  return (
    <div className={styles.banner}>
      <div className={styles.titleBlock}>
        <span className={styles.eyebrow}>
          {org?.name ?? "Organization"} · Task
        </span>
        <span className={styles.title}>{task.title}</span>
        <span className={styles.meta}>
          host {hostStatus} · started {formatElapsed(elapsedMs)} ago ·{" "}
          {task.scope.length} repo{task.scope.length === 1 ? "" : "s"} in scope
        </span>
        {task.status === "failed" && task.error && (
          <span className={styles.errorMeta} title={task.error}>
            {task.error}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <span className={styles.status} data-status={task.status}>
          {task.status}
        </span>
        {isRunning && !hostMissing && (
          <Button variant="ghost" onClick={handleCancel} disabled={busy}>
            Cancel task
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" onClick={handleDelete} disabled={busy}>
            Delete task
          </Button>
        )}
      </div>
    </div>
  );
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
