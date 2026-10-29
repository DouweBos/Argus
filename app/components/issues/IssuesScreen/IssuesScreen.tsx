import type { LinearIssue, LinearIssueScope } from "../../../lib/types";
import { type ReactNode, useEffect, useState } from "react";
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
  refreshLinearIssues,
  setIssuesLayout,
  useIssueFilters,
  useIssuesLayout,
  useLinearConnected,
  useLinearIssueList,
} from "../../../stores/linearIssuesStore";
import { useSessionProjects } from "../../../stores/sessionStore";
import { showSettingsDialog } from "../../../stores/settingsStore";
import { openStartDraft } from "../../../stores/startDraftStore";
import { IssueDetailPage } from "../IssueDetail/IssueDetailPage";
import { IssueFilterBar } from "./IssueFilterBar";
import { IssuesBoardView } from "./IssuesBoardView";
import { IssuesListView } from "./IssuesListView";
import styles from "./IssuesScreen.module.css";

const SCOPES = [
  { value: "assigned" as const, label: "Assigned" },
  { value: "created" as const, label: "Created" },
  { value: "subscribed" as const, label: "Subscribed" },
];

const SCOPE_TITLES: Record<LinearIssueScope, string> = {
  assigned: "Assigned to me",
  created: "Created by me",
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
  const { issueRef, issueScope } = useCurrentRoute();
  const connected = useLinearConnected();
  const { data: allIssues, error, loading } = useLinearIssueList(issueScope);
  const filters = useIssueFilters(issueScope);
  const data = allIssues && applyFilters(allIssues, filters);
  const layout = useIssuesLayout();
  const projects = useSessionProjects();
  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const repoRoot = pickedRoot ?? projects[0]?.repoRoot ?? null;

  useEffect(() => {
    if (connected) {
      refreshLinearIssues(issueScope).catch(() => {});
    }
  }, [connected, issueScope]);

  const open = (issue: LinearIssue) =>
    appNavigate({ view: "issues", issueScope, issueRef: issue.identifier });
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
        title="No open issues here"
        body={
          filters.length > 0
            ? "No open issues match these filters."
            : "Open issues in this view show up here."
        }
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
          appNavigate({ view: "issues", issueScope, issueRef: null })
        }
        onOpen={(identifier) =>
          appNavigate(
            { view: "issues", issueScope, issueRef: identifier },
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
        subtitle="Your open Linear issues"
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
                  refreshLinearIssues(issueScope).catch(() => {});
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
          <SegmentedControl<LinearIssueScope>
            aria-label="Whose issues"
            options={SCOPES}
            value={issueScope}
            onChange={(scope) =>
              appNavigate({ view: "issues", issueScope: scope, issueRef: null })
            }
          />
          <div className={styles.toolbarEnd}>
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
