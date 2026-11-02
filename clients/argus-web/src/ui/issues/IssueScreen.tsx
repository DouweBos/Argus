/**
 * One Linear issue as Linear shows it. With control: change its status and
 * priority, comment, reply, or start an agent on it.
 */

import { useEffect, useState } from "react";
import {
  ago,
  cycleLabel,
  describeError,
  formatIssueDate,
  ISSUE_SCOPE_TITLES,
  isFigmaUrl,
  issueOrder,
  issueTimeline,
  lastChange,
  linearMediaFor,
  PRIORITY_OPTIONS,
  sessionForIssue,
  shortDuration,
  statusOptions,
  timeInStatus,
} from "@argus/client-core";
import {
  IssueActivitySection,
  IssueBody,
  IssueDetailPage,
  IssueMediaEmbed,
  IssueProperties,
} from "@argus/peacock";
import type { LinearIssue, RemoteSession } from "@argus/remote-protocol";
import { estimateName } from "@argus/remote-protocol/linearLabels";
import { openAgent, openDesign } from "../../routing/open";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import {
  commentOnIssue,
  loadIssue,
  updateIssue,
  useIssuesStore,
} from "../../stores/issues";
import { useProjectsStore } from "../../stores/projects";
import type { IssuesScreenState } from "./IssuesScreen";
import { IssueStartDialog } from "./IssueStartDialog";

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}

/** Figma links open in the design viewer; true when this one did. */
function openFigmaLink(url: string): boolean {
  if (!isFigmaUrl(url)) {
    return false;
  }
  openDesign(url, { source: "issue" });

  return true;
}

/** Uploads need the computer's Linear sign-in, which the gateway doesn't lend: they stay links. */
function renderEmbed(kind: "image" | "link", url: string, label: string) {
  const media = linearMediaFor(kind, url, label);

  return media ? (
    <IssueMediaEmbed
      kind={media.kind}
      label={media.label}
      src="link"
      url={media.url}
    />
  ) : null;
}

function useListOrder(screen: IssuesScreenState): string[] {
  const list = useIssuesStore((s) =>
    screen.scope === "search" ? s.search.data : s.lists[screen.scope].data,
  );

  return issueOrder(list ?? []);
}

/** Straight to its newest agent when one is live, otherwise the session's home. */
function openSession(session: RemoteSession): void {
  const agent = useProjectsStore
    .getState()
    .recentAgents.filter((a) => a.session_id === session.id)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
  if (agent) {
    openAgent(agent);
  } else {
    appNavigate({ name: "sessionHome", sessionId: session.id });
  }
}

export function IssueScreen({
  issueRef,
  screen,
}: {
  issueRef: string;
  screen: IssuesScreenState;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const issue = useIssuesStore((s) => s.details[issueRef] ?? null);
  const states = useIssuesStore((s) =>
    issue ? s.statesByTeam[issue.teamId] : undefined,
  );
  const projects = useProjectsStore((s) => s.projects);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const loadSessions = useProjectsStore((s) => s.loadSessions);
  const order = useListOrder(screen);
  const [failure, setFailure] = useState<{ ref: string; message: string }>();
  const [changeError, setChangeError] = useState<string | null>(null);
  const [starting, setStarting] = useState<LinearIssue | null>(null);
  const session = issue
    ? sessionForIssue(issue, Object.values(sessionsByRepo).flat())
    : null;

  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    loadIssue(issueRef).then(
      (found) =>
        !cancelled &&
        !found &&
        setFailure({ ref: issueRef, message: `Linear has no issue ${issueRef}.` }),
      (err: unknown) =>
        !cancelled && setFailure({ ref: issueRef, message: describeError(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [ready, issueRef]);

  // "Open session" needs every project's sessions, not just the ones opened.
  useEffect(() => {
    if (ready) {
      for (const p of projects) {
        loadSessions(p.repo_root).catch(() => {});
      }
    }
  }, [ready, projects, loadSessions]);

  const go = (identifier: string | null, replace = false) =>
    appNavigate({ ...screen, issueRef: identifier }, { replace });

  return (
    <>
      <IssueDetailPage
        aside={
          issue && (
            <IssueProperties
              ago={ago}
              canEdit={hasControl}
              cycleLabel={cycleLabel(issue.cycle)}
              error={changeError}
              estimateLabel={
                issue.estimate == null
                  ? null
                  : estimateName(issue.estimate, issue.estimateType)
              }
              formatDate={formatIssueDate}
              issue={issue}
              priorityChange={lastChange(issue.history, "priority")}
              priorityOptions={PRIORITY_OPTIONS}
              statusOptions={statusOptions(states ?? [issue.state])}
              statusStints={timeInStatus(issue.statusHistory ?? []).map(
                (s) => ({ ...s, duration: shortDuration(s.duration) }),
              )}
              onChange={(patch) => {
                setChangeError(null);
                updateIssue(issue.id, patch).catch((err: unknown) =>
                  setChangeError(describeError(err)),
                );
              }}
              onOpenExternal={() => openExternal(issue.url)}
              onOpenSession={session ? () => openSession(session) : null}
              onStart={
                hasControl && projects.length > 0
                  ? () => setStarting(issue)
                  : null
              }
            />
          )
        }
        error={failure?.ref === issueRef ? failure.message : null}
        issue={issue}
        issueRef={issueRef}
        listTitle={ISSUE_SCOPE_TITLES[screen.scope]}
        order={order}
        onClose={() => go(null)}
        onOpen={(identifier) => go(identifier, true)}
        onOpenExternal={openExternal}
      >
        {issue && (
          <>
            <IssueBody
              ago={ago}
              isDesignUrl={isFigmaUrl}
              issue={issue}
              renderEmbed={renderEmbed}
              onLinkClick={openFigmaLink}
              onOpenIssue={(identifier) => go(identifier)}
              onOpenResource={(url) => {
                if (!openFigmaLink(url)) {
                  openExternal(url);
                }
              }}
            />
            <IssueActivitySection
              ago={ago}
              issue={issue}
              renderEmbed={renderEmbed}
              timeline={issueTimeline(issue)}
              onComment={
                hasControl
                  ? (body, parentId) => commentOnIssue(issue, body, parentId)
                  : null
              }
              onLinkClick={openFigmaLink}
            />
          </>
        )}
      </IssueDetailPage>
      {starting && (
        <IssueStartDialog
          issues={[starting]}
          onClose={() => setStarting(null)}
        />
      )}
    </>
  );
}
