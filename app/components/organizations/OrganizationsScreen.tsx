import type { Organization, OrgTask } from "../../lib/types";
import { useState } from "react";
import { Button, Icons } from "@argus/peacock";
import {
  showCreateOrganizationDialog,
  showEditOrganizationDialog,
  showStartTaskDialog,
} from "../../stores/dialogStore";
import {
  useOrganizationSync,
  useOrganizations,
} from "../../stores/organizationStore";
import {
  setActiveOrgTask,
  useOrgTaskSync,
  useOrgTasks,
} from "../../stores/orgTaskStore";
import { OrganizationDialogHost } from "../home/OrganizationDialog/OrganizationDialog";
import styles from "./OrganizationsScreen.module.css";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function OrganizationsScreen() {
  useOrganizationSync();
  useOrgTaskSync();
  const orgs = useOrganizations();
  const tasks = useOrgTasks();
  const runningTasks = tasks.filter((t) => t.status === "running").length;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>Organizations</span>
          <span className={styles.sub}>
            {orgs.length === 0
              ? "Group repos that ship one product together"
              : `${orgs.length} ${orgs.length === 1 ? "organization" : "organizations"}${
                  runningTasks > 0
                    ? ` · ${runningTasks} running task${runningTasks === 1 ? "" : "s"}`
                    : ""
                }`}
          </span>
        </div>
        <Button
          variant="primary"
          leading={<Icons.PlusIcon size={12} />}
          onClick={showCreateOrganizationDialog}
        >
          New organization
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div className={styles.empty}>
          <Icons.OrganizationIcon size={32} />
          <p className={styles.emptyTitle}>No organizations yet</p>
          <p className={styles.emptyBody}>
            Organizations let you group a backend, frontend, and mobile repo
            into one product. Once created, start a task to fan work out across
            every member repo in parallel — each agent sees the shared prompt
            and the sibling worktree paths so they can coordinate.
          </p>
          <Button
            variant="primary"
            leading={<Icons.PlusIcon size={12} />}
            onClick={showCreateOrganizationDialog}
          >
            Create your first organization
          </Button>
        </div>
      ) : (
        <div className={styles.list}>
          {orgs.map((org) => (
            <OrganizationCard
              key={org.id}
              org={org}
              tasks={tasks.filter((t) => t.organization_id === org.id)}
            />
          ))}
        </div>
      )}

      <OrganizationDialogHost />
    </div>
  );
}

function OrganizationCard({
  org,
  tasks,
}: {
  org: Organization;
  tasks: OrgTask[];
}) {
  const [expanded, setExpanded] = useState(tasks.length > 0);
  const running = tasks.filter((t) => t.status === "running").length;
  const canStart = org.members.length > 0;

  const sortedTasks = [...tasks].sort((a, b) => b.created_at - a.created_at);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span
          className={styles.accent}
          style={{ background: org.accent }}
          aria-hidden="true"
        />
        <div className={styles.cardBody}>
          <span className={styles.name}>{org.name}</span>
          {org.description && (
            <span className={styles.desc}>{org.description}</span>
          )}
          <span className={styles.members}>
            {org.members.length === 0
              ? "no repos yet"
              : org.members.map((m) => basename(m.repo_root)).join(" · ")}
            {tasks.length > 0 && (
              <>
                {" · "}
                {running > 0
                  ? `${running} running`
                  : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
              </>
            )}
          </span>
        </div>
        <div className={styles.cardActions}>
          <Button
            variant="primary"
            leading={<Icons.PlayIcon size={11} />}
            onClick={() => showStartTaskDialog(org.id)}
            disabled={!canStart}
            title={canStart ? undefined : "Add member repos first"}
          >
            Start task
          </Button>
          <Button
            variant="ghost"
            leading={<Icons.PencilIcon size={11} />}
            onClick={() => showEditOrganizationDialog(org.id)}
          >
            Edit
          </Button>
        </div>
      </div>

      <button
        type="button"
        className={styles.expandToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <Icons.ChevronDownIcon size={11} />
        ) : (
          <Icons.ChevronRightIcon size={11} />
        )}
        <span>
          {tasks.length === 0
            ? "No tasks yet"
            : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
      </button>

      {expanded && sortedTasks.length > 0 && (
        <div className={styles.tasks}>
          {sortedTasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
      {expanded && sortedTasks.length === 0 && canStart && (
        <div className={styles.noTasks}>
          Click “Start task” to fan a prompt out across every member repo in
          parallel.
        </div>
      )}
      {expanded && !canStart && (
        <div className={styles.noTasks}>
          Add member repos to this organization before starting a task.
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
        {task.members.map((m) => (
          <span
            key={m.repo_root}
            className={styles.memberChip}
            data-status={m.status}
            title={`${basename(m.repo_root)} — ${m.status}`}
          >
            {basename(m.repo_root)}
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
