import type { Organization, OrgTask } from "../../../lib/types";
import { useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { openOrganization } from "../../../stores/centerViewStore";
import {
  showCreateOrganizationDialog,
  showEditOrganizationDialog,
} from "../../../stores/dialogStore";
import {
  setActiveOrgTask,
  useOrgTasks,
  useOrgTaskSync,
} from "../../../stores/orgTaskStore";
import { useOrganizations } from "../../../stores/organizationStore";
import styles from "./OrganizationsPanel.module.css";

export function OrganizationsPanel() {
  const orgs = useOrganizations();
  useOrgTaskSync();
  const tasks = useOrgTasks();

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Organizations</span>
        <span className={styles.sub}>
          {orgs.length === 0
            ? "group repos that ship one product together"
            : `${orgs.length} ${orgs.length === 1 ? "org" : "orgs"}`}
        </span>
        <div className={styles.spacer} />
        <Button
          variant="ghost"
          leading={<Icons.PlusIcon size={11} />}
          onClick={showCreateOrganizationDialog}
        >
          New organization
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div className={styles.empty}>
          Organizations let you group a backend + frontend + mobile repo into
          one product. Agents spawned inside a member repo inherit the
          organization&apos;s system prompt so they understand how the repos fit
          together.
        </div>
      ) : (
        <div className={styles.list}>
          {orgs.map((org) => (
            <OrganizationRow
              key={org.id}
              org={org}
              tasks={tasks.filter((t) => t.organization_id === org.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrganizationRow({
  org,
  tasks,
}: {
  org: Organization;
  tasks: OrgTask[];
}) {
  const [expanded, setExpanded] = useState(false);
  const running = tasks.filter((t) => t.status === "running").length;

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.rowMain}
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className={styles.accent}
            style={{ background: org.accent }}
            aria-hidden="true"
          />
          <span className={styles.rowBody}>
            <span className={styles.name}>{org.name}</span>
            {org.description && (
              <span className={styles.desc}>{org.description}</span>
            )}
            <span className={styles.members}>
              {org.members.length === 0
                ? "no repos yet"
                : org.members
                    .map((m) => basename(m.repo_root))
                    .slice(0, 4)
                    .join(" · ") +
                  (org.members.length > 4 ? ` +${org.members.length - 4}` : "")}
              {tasks.length > 0 && (
                <>
                  {" · "}
                  {running > 0
                    ? `${running} running`
                    : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
                </>
              )}
            </span>
          </span>
        </button>
        <div className={styles.rowActions}>
          <Button
            variant="primary"
            onClick={() => openOrganization(org.id)}
            disabled={org.members.length === 0}
          >
            Start task
          </Button>
          <Button
            variant="ghost"
            onClick={() => showEditOrganizationDialog(org.id)}
          >
            Edit
          </Button>
        </div>
      </div>
      {expanded && tasks.length > 0 && (
        <div className={styles.tasks}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
      {expanded && tasks.length === 0 && (
        <div className={styles.noTasks}>
          No tasks yet. Start one to fan out work across member repos.
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: OrgTask }) {
  return (
    <button
      type="button"
      className={styles.taskRow}
      onClick={() => setActiveOrgTask(task.id)}
    >
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.taskStatus} data-status={task.status}>
        {task.status}
      </span>
      <span className={styles.taskMembers}>
        {task.scope.map((s) => (
          <span
            key={s.repo_root}
            className={styles.memberChip}
            title={basename(s.repo_root)}
          >
            {basename(s.repo_root)}
          </span>
        ))}
      </span>
      <span className={styles.taskTime}>{formatTimeAgo(task.created_at)}</span>
    </button>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);

  return `${day}d ago`;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
