/**
 * `/sessions/archived`: every archived session by project, newest archived
 * first, to open or restore. Archiving hides a session from the lists; its
 * worktree stays.
 */

import {
  archivedSessions,
  sessionTitle,
  setWorkflowStatus,
  shortAge,
} from "@argus/client-core";
import {
  Button,
  EmptyState,
  FeedItem,
  Icons,
  SectionPanel,
  SessionStatusIcon,
} from "@argus/peacock";
import type { RemoteSession } from "../lib/protocol";
import { appNavigate } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import { useProjectsStore } from "../stores/projects";

export function ArchivedSessionsView() {
  const projects = useProjectsStore((s) => s.projects);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const setSessionArchived = useProjectsStore((s) => s.setSessionArchived);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const groups = projects
    .map((project) => ({
      project,
      sessions: archivedSessions(sessionsByRepo[project.repo_root] ?? []),
    }))
    .filter((g) => g.sessions.length > 0);

  if (groups.length === 0) {
    return (
      <EmptyState
        body="Archive a session from its menu to hide it from the list. It comes back here, worktree and all."
        icon={<Icons.ArchiveIcon size={20} />}
        title="Nothing archived"
      />
    );
  }

  const row = (session: RemoteSession) => {
    const status = setWorkflowStatus(session);

    return (
      <FeedItem
        key={session.id}
        detail={session.status_note ?? session.branch}
        icon={
          status ? (
            <SessionStatusIcon size={14} status={status} />
          ) : (
            <Icons.BranchIcon size={14} />
          )
        }
        role="button"
        tabIndex={0}
        time={
          session.archived_at
            ? `Archived ${shortAge(session.archived_at)} ago`
            : undefined
        }
        title={sessionTitle(session)}
        trailing={
          hasControl ? (
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setSessionArchived(session, false).catch(() => {});
              }}
            >
              Restore
            </Button>
          ) : undefined
        }
        onClick={() => appNavigate({ name: "session", sessionId: session.id })}
      />
    );
  };

  return (
    <div className="aw-flush">
      {groups.map(({ project, sessions }) => (
        <SectionPanel key={project.repo_root} plain title={project.name}>
          {sessions.map(row)}
        </SectionPanel>
      ))}
    </div>
  );
}
