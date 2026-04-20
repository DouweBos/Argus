import type { Organization, OrgTask } from "../../lib/types";
import { useState } from "react";
import { Button, Icons, StatCell, StatsStrip } from "@argus/peacock";
import {
  openOrganization,
  useSelectedOrganizationId,
} from "../../stores/centerViewStore";
import {
  showCreateOrganizationDialog,
  showEditOrganizationDialog,
} from "../../stores/dialogStore";
import {
  setActiveOrgTask,
  useOrgTaskSync,
  useOrgTasks,
} from "../../stores/orgTaskStore";
import {
  useOrganizationSync,
  useOrganizations,
} from "../../stores/organizationStore";
import { OrganizationDialogHost } from "../home/OrganizationDialog/OrganizationDialog";
import homeStyles from "../home/homeLayout.module.css";
import styles from "./OrganizationsScreen.module.css";
import { StartTaskComposer } from "./StartTaskComposer";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function OrganizationsScreen() {
  useOrganizationSync();
  useOrgTaskSync();
  const orgs = useOrganizations();
  const tasks = useOrgTasks();
  const selectedOrgId = useSelectedOrganizationId();
  const runningTasks = tasks.filter((t) => t.status === "running").length;

  const selectedOrg = selectedOrgId
    ? (orgs.find((o) => o.id === selectedOrgId) ?? null)
    : null;

  if (selectedOrg) {
    const orgTasks = tasks.filter((t) => t.organization_id === selectedOrg.id);

    return (
      <>
        <OrganizationHome org={selectedOrg} tasks={orgTasks} />
        <OrganizationDialogHost />
      </>
    );
  }

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

function OrganizationHome({
  org,
  tasks,
}: {
  org: Organization;
  tasks: OrgTask[];
}) {
  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const sortedTasks = [...tasks].sort((a, b) => b.created_at - a.created_at);

  return (
    <div className={homeStyles.screen}>
      <div className={homeStyles.wrap}>
        <div className={homeStyles.hero}>
          <div
            className={homeStyles.brandMark}
            style={{ ["--hero-accent" as string]: org.accent }}
          >
            <div className={homeStyles.heroBadge}>
              <Icons.OrganizationIcon size={18} />
            </div>
            <div>
              <h1 className={homeStyles.title}>{org.name}</h1>
              <div className={homeStyles.sub}>
                {org.members.length} repo{org.members.length === 1 ? "" : "s"}
                {tasks.length > 0 && (
                  <>
                    <span className={homeStyles.dot}>·</span>
                    {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  </>
                )}
                {running > 0 && (
                  <>
                    <span className={homeStyles.dot}>·</span>
                    {running} running
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={homeStyles.heroSpacer} />
          <div className={homeStyles.ctas}>
            <Button
              variant="ghost"
              leading={<Icons.PencilIcon size={12} />}
              onClick={() => showEditOrganizationDialog(org.id)}
            >
              Edit
            </Button>
          </div>
        </div>

        {org.description && (
          <div className={homeStyles.repoPath}>{org.description}</div>
        )}

        <StatsStrip>
          <StatCell
            label="Tasks running"
            value={running}
            delta={running > 0 ? "in progress" : `${tasks.length} total`}
            deltaTone={running > 0 ? "positive" : "neutral"}
            live={running > 0}
          />
          <StatCell
            label="Member repos"
            value={org.members.length}
            delta={org.members.length > 0 ? "ready" : "add repos"}
            deltaTone={org.members.length > 0 ? "neutral" : "negative"}
          />
          <StatCell
            label="Completed"
            value={completed}
            delta="across all tasks"
          />
          <StatCell
            label="Failed"
            value={failed}
            delta={failed > 0 ? "needs attention" : "none"}
            deltaTone={failed > 0 ? "negative" : "neutral"}
          />
        </StatsStrip>

        <div className={homeStyles.grid}>
          <div className={homeStyles.col}>
            <div className={homeStyles.panel}>
              <div className={homeStyles.panelHead}>
                <span className={homeStyles.eyebrow}>New task</span>
                <span className={homeStyles.subMeta}>
                  prompt · implement across selected repos
                </span>
              </div>
              <div className={styles.composerWrap}>
                <StartTaskComposer org={org} />
              </div>
            </div>

            <div className={homeStyles.panel}>
              <div className={homeStyles.panelHead}>
                <span className={homeStyles.eyebrow}>Tasks</span>
                <span className={homeStyles.subMeta}>{tasks.length} total</span>
              </div>
              <div className={homeStyles.panelScroll}>
                {sortedTasks.length === 0 ? (
                  <div className={homeStyles.emptyCell}>
                    No tasks yet. Send a prompt above to fan work out across
                    every selected repo.
                  </div>
                ) : (
                  <div className={styles.tasks}>
                    {sortedTasks.map((t) => (
                      <TaskRow key={t.id} task={t} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={homeStyles.col}>
            <div className={homeStyles.panel}>
              <div className={homeStyles.panelHead}>
                <span className={homeStyles.eyebrow}>Member repos</span>
                <span className={homeStyles.subMeta}>
                  {org.members.length} bound
                </span>
                <div className={homeStyles.panelSpacer} />
                <button
                  type="button"
                  className={homeStyles.linkBtn}
                  onClick={() => showEditOrganizationDialog(org.id)}
                >
                  Edit
                </button>
              </div>
              <div className={styles.memberList}>
                {org.members.length === 0 ? (
                  <div className={homeStyles.emptyCell}>
                    No member repos yet.
                  </div>
                ) : (
                  org.members.map((m) => (
                    <div key={m.repo_root} className={styles.memberRow}>
                      <span className={styles.memberIcon}>
                        <Icons.RepoIcon size={12} />
                      </span>
                      <div className={styles.memberBody}>
                        <span className={styles.memberName}>
                          {basename(m.repo_root)}
                        </span>
                        {m.role && (
                          <span className={styles.memberRole}>{m.role}</span>
                        )}
                        <span className={styles.memberPath}>{m.repo_root}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
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
            onClick={() => openOrganization(org.id)}
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
          Open this organization to send a prompt across every member repo in
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
