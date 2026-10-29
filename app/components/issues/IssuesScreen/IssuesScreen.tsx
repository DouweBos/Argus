import type { IssueScope } from "../../../lib/router";
import type { LinearIssue } from "../../../lib/types";
import { type ReactNode, useState } from "react";
import {
  Button,
  EmptyState,
  GridScreen,
  Icons,
  SegmentedControl,
  Select,
  Spinner,
} from "@argus/peacock";
import { issueOrder } from "../../../lib/issueActivity";
import { applyFilters } from "../../../lib/issueFilters";
import { useCurrentRoute } from "../../../lib/routeHooks";
import { appNavigate } from "../../../lib/router";
import {
  type IssuesLayout,
  setIssuesLayout,
  useIssueFilters,
  useIssuesLayout,
  useLinearConnected,
} from "../../../stores/linearIssuesStore";
import { useSessionProjects } from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { openStartDraft } from "../../../stores/startDraftStore";
import { IssueDetailPage } from "../IssueDetail/IssueDetailPage";
import { IssueFilterBar } from "./IssueFilterBar";
import { IssueSearchField } from "./IssueSearchField";
import { IssuesBoardView } from "./IssuesBoardView";
import { IssuesListView } from "./IssuesListView";
import styles from "./IssuesScreen.module.css";
import { useIssueResults } from "./useIssueResults";

const SCOPES = [
  { value: "assigned" as const, label: "Assigned" },
  { value: "created" as const, label: "Created" },
  { value: "subscribed" as const, label: "Subscribed" },
];

const SCOPE_TITLES: Record<IssueScope, string> = {
  assigned: "Assigned to me",
  created: "Created by me",
  search: "Search",
  subscribed: "Subscribed",
};

const LAYOUTS = [
  { value: "board" as const, label: "Board" },
  { value: "list" as const, label: "List" },
];

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/**
 * Your Linear work as a board — a column per status, a lane per priority — so
 * you can pick what's next, read the ticket, and hand it to an agent without
 * leaving Argus.
 */
export function IssuesScreen() {
  const { issueQuery, issueRef, issueScope } = useCurrentRoute();
  const connected = useLinearConnected();
  const searching = issueScope === "search";
  const {
    data: allIssues,
    error,
    loading,
    refresh,
  } = useIssueResults(issueScope, issueQuery);
  const filters = useIssueFilters(issueScope);
  const data = allIssues && applyFilters(allIssues, filters);
  const layout = useIssuesLayout();
  const projects = useSessionProjects();
  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const repoRoot = pickedRoot ?? projects[0]?.repoRoot ?? null;

  const open = (issue: LinearIssue) =>
    appNavigate({
      view: "issues",
      issueScope,
      issueRef: issue.identifier,
      issueQuery,
    });
  const start = repoRoot
    ? (identifier: string) => {
        openStartDraft(repoRoot, {
          issueRefs: [identifier],
          workspace: "worktree",
        }).catch(() => {});
      }
    : null;

  let content: ReactNode;
  if (!connected) {
    content = (
      <EmptyState
        icon={<Icons.LinearIcon size={20} />}
        title="Connect Linear"
        body="See your issues by status and priority, read them in full, and start agents on them."
        action={
          <Button
            variant="primary"
            onClick={() => showSettingsDialog("integrations")}
          >
            Open Settings
          </Button>
        }
      />
    );
  } else if (data === null && error) {
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't fetch issues"
        body={error}
      />
    );
  } else if (data === null) {
    content = (
      <EmptyState
        icon={<Spinner size="md" />}
        title="Loading issues"
        body="Asking Linear for your open issues."
      />
    );
  } else if (data.length === 0) {
    content = (
      <EmptyState
        icon={<Icons.CheckIcon size={20} />}
        title={searching ? "No issues match" : "No open issues here"}
        body={emptyBody(searching, issueQuery, filters.length > 0)}
      />
    );
  } else if (layout === "board") {
    content = (
      <IssuesBoardView issues={data} selected={issueRef} onOpen={open} />
    );
  } else {
    content = (
      <IssuesListView issues={data} selected={issueRef} onOpen={open} />
    );
  }

  // An open issue takes the whole screen, the way Linear opens one.
  if (issueRef && connected) {
    return (
      <IssueDetailPage
        issueRef={issueRef}
        listTitle={SCOPE_TITLES[issueScope]}
        order={issueOrder(data ?? [])}
        onClose={() =>
          appNavigate({
            view: "issues",
            issueScope,
            issueRef: null,
            issueQuery,
          })
        }
        onOpen={(identifier) =>
          appNavigate(
            { view: "issues", issueScope, issueRef: identifier, issueQuery },
            { replace: true },
          )
        }
        onStart={start}
      />
    );
  }

  return (
    <GridScreen>
      <GridScreen.Header
        title="Issues"
        subtitle={
          searching && issueQuery
            ? `${data?.length ?? "…"} results for “${issueQuery}”`
            : "Your open Linear issues"
        }
        actions={
          connected && (
            <div className={styles.headerActions}>
              {projects.length > 1 && repoRoot && (
                <Select
                  aria-label="Project to start agents in"
                  value={repoRoot}
                  onChange={(e) => setPickedRoot(e.target.value)}
                >
                  {projects.map((p) => (
                    <option
                      key={`${p.hostId}:${p.repoRoot}`}
                      value={p.repoRoot}
                    >
                      Start in {basename(p.repoRoot)}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={loading}
                leading={<Icons.RefreshIcon size={12} />}
                onClick={() => {
                  refresh().catch(() => {});
                }}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          )
        }
      />
      {connected && (
        <div className={styles.toolbar}>
          <SegmentedControl<IssueScope>
            aria-label="Whose issues"
            options={SCOPES}
            value={issueScope}
            onChange={(scope) =>
              appNavigate({ view: "issues", issueScope: scope, issueRef: null })
            }
          />
          <div className={styles.toolbarEnd}>
            <IssueSearchField
              key={searching ? "search" : "scope"}
              query={issueQuery}
            />
            <SegmentedControl<IssuesLayout>
              aria-label="Layout"
              options={LAYOUTS}
              value={layout}
              onChange={setIssuesLayout}
            />
          </div>
        </div>
      )}
      {connected && allIssues && (
        <IssueFilterBar issues={allIssues} scope={issueScope} />
      )}
      {content}
    </GridScreen>
  );
}

function emptyBody(
  searching: boolean,
  query: string | null,
  filtered: boolean,
): string {
  if (searching) {
    return query
      ? `Nothing in Linear matches “${query}”${filtered ? " with these filters" : ""}.`
      : "Type to search every issue in the workspace.";
  }

  return filtered
    ? "No open issues match these filters."
    : "Open issues in this view show up here.";
}
