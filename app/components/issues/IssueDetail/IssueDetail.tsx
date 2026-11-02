import { useEffect, useState } from "react";
import {
  ago,
  cycleLabel,
  formatIssueDate,
  issueTimeline,
  lastChange,
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
  IssueProperties,
} from "@argus/peacock";
import { estimateName } from "@argus/remote-protocol";
import { figmaLinkHandler, isFigmaUrl } from "../../../lib/designViewer";
import { openExternalUrl } from "../../../lib/ipc";
import { appNavigate } from "../../../lib/router";
import {
  changeLinearIssue,
  loadLinearIssueDetail,
  loadTeamStates,
  postLinearComment,
  useLinearIssueDetail,
  useTeamStates,
} from "../../../stores/linearIssuesStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { renderLinearEmbed } from "./linearEmbed";

const openFigmaLink = figmaLinkHandler("issue");

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function openExternal(url: string): void {
  openExternalUrl(url).catch(() => {});
}

function openIssue(identifier: string): void {
  appNavigate({ view: "issues", issueRef: identifier });
}

interface IssueDetailProps {
  issueRef: string;
  listTitle: string;
  onClose: () => void;
  onOpen: (identifier: string) => void;
  /** Null when there's no project to start an agent in. */
  onStart: ((identifier: string) => void) | null;
  order: string[];
}

/** The desktop's wiring of Peacock's issue page: its store, IPC and router. */
export function IssueDetail({
  issueRef,
  listTitle,
  onClose,
  onOpen,
  onStart,
  order,
}: IssueDetailProps) {
  const issue = useLinearIssueDetail(issueRef);
  const states = useTeamStates(issue?.teamId ?? "");
  const sessions = useSessions();
  const session = issue ? sessionForIssue(issue, sessions) : null;
  // Keyed by issue, so moving to the next one drops the last one's errors.
  const [failure, setFailure] = useState<{ message: string; ref: string }>();
  const [changeError, setChangeError] = useState<{
    message: string;
    ref: string;
  }>();

  useEffect(() => {
    let cancelled = false;
    loadLinearIssueDetail(issueRef).then(
      (found) =>
        !cancelled &&
        !found &&
        setFailure({
          ref: issueRef,
          message: `Linear has no issue ${issueRef}.`,
        }),
      (err: unknown) =>
        !cancelled && setFailure({ ref: issueRef, message: message(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [issueRef]);

  useEffect(() => {
    if (issue?.teamId) {
      loadTeamStates(issue.teamId).catch(() => {});
    }
  }, [issue?.teamId]);

  return (
    <IssueDetailPage
      aside={
        issue && (
          <IssueProperties
            ago={ago}
            canEdit
            cycleLabel={cycleLabel(issue.cycle)}
            error={changeError?.ref === issueRef ? changeError.message : null}
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
            statusStints={timeInStatus(issue.statusHistory ?? []).map((s) => ({
              ...s,
              duration: shortDuration(s.duration),
            }))}
            onChange={(patch) => {
              setChangeError(undefined);
              changeLinearIssue(issue.id, patch).catch((err: unknown) =>
                setChangeError({ ref: issueRef, message: message(err) }),
              );
            }}
            onOpenExternal={() => openExternal(issue.url)}
            onOpenSession={session ? () => selectSession(session.id) : null}
            onStart={onStart && (() => onStart(issue.identifier))}
          />
        )
      }
      error={failure?.ref === issueRef ? failure.message : null}
      issue={issue}
      issueRef={issueRef}
      listTitle={listTitle}
      order={order}
      onClose={onClose}
      onOpen={onOpen}
      onOpenExternal={openExternal}
    >
      {issue && (
        <>
          <IssueBody
            ago={ago}
            isDesignUrl={isFigmaUrl}
            issue={issue}
            renderEmbed={renderLinearEmbed}
            onLinkClick={openFigmaLink}
            onOpenIssue={openIssue}
            onOpenResource={(url) => {
              if (!openFigmaLink(url)) {
                openExternal(url);
              }
            }}
          />
          <IssueActivitySection
            ago={ago}
            issue={issue}
            renderEmbed={renderLinearEmbed}
            timeline={issueTimeline(issue)}
            onComment={(body, parentId) =>
              postLinearComment(issue, body, parentId)
            }
            onLinkClick={openFigmaLink}
          />
        </>
      )}
    </IssueDetailPage>
  );
}
