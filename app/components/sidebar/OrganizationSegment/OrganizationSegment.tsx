import type { Organization } from "../../../lib/types";
import { useState } from "react";
import { Icons, SidebarRepoAction, SidebarRepoGroup } from "@argus/peacock";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  openOrganization,
  useCenterView,
  useSelectedOrganizationId,
} from "../../../stores/centerViewStore";
import { showEditOrganizationDialog } from "../../../stores/dialogStore";
import {
  deleteOrgTask,
  taskLiveStatus,
  useOrgTasks,
  useOrgTaskSync,
} from "../../../stores/orgTaskStore";
import {
  selectSession,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";
import { SessionCard } from "../SessionCard";
import styles from "./OrganizationSegment.module.css";

interface OrganizationSegmentProps {
  org: Organization;
}

export function OrganizationSegment({ org }: OrganizationSegmentProps) {
  useOrgTaskSync();
  const centerView = useCenterView();
  const selectedOrgId = useSelectedOrganizationId();
  const selectedSessionId = useSelectedSessionId();
  const sessions = useSessions();
  const agents = useAgentsRecord();
  const allTasks = useOrgTasks();
  const isActive = centerView === "organizations" && selectedOrgId === org.id;

  const orgTasks = allTasks.filter((t) => t.organization_id === org.id);
  const liveTasks = orgTasks
    .map((t) => ({
      task: t,
      status: taskLiveStatus(
        t,
        t.host_agent_id ? agents[t.host_agent_id] : undefined,
      ),
      session: t.host_session_id
        ? sessions.find((s) => s.id === t.host_session_id)
        : undefined,
    }))
    .filter(
      (x) => x.session && (x.status === "running" || x.status === "pending"),
    );

  const [expanded, setExpanded] = useState(liveTasks.length > 0);

  const openOrganizations = () => {
    openOrganization(org.id);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <SidebarRepoGroup
      name={org.name}
      color={org.accent}
      expanded={expanded}
      active={isActive}
      leading={<Icons.OrganizationIcon size={11} />}
      subtitle={
        org.members.length === 0
          ? "no repos yet"
          : `${org.members.length} ${org.members.length === 1 ? "repo" : "repos"}`
      }
      onHeaderClick={openOrganizations}
      onToggleExpanded={() => setExpanded((v) => !v)}
      actions={
        <SidebarRepoAction
          title="Edit organization"
          onClick={(e) => {
            stop(e);
            showEditOrganizationDialog(org.id);
          }}
        >
          <Icons.PencilIcon size={11} />
        </SidebarRepoAction>
      }
    >
      <div className={styles.list} role="listbox" aria-label="Tasks">
        {liveTasks.length === 0 ? (
          <p className={styles.emptyHint}>No running tasks.</p>
        ) : (
          liveTasks.map(({ task, session }) =>
            session ? (
              <SessionCard
                key={task.id}
                session={{ ...session, display_name: task.title }}
                isSelected={session.id === selectedSessionId}
                iconOverride={<Icons.TaskIcon size={13} />}
                onSelect={() => selectSession(session.id)}
                onDelete={async () => {
                  await deleteOrgTask(task.id);
                }}
              />
            ) : null,
          )
        )}
      </div>
    </SidebarRepoGroup>
  );
}
