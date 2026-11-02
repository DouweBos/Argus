/**
 * `/issues[/<scope>][/<ID>]` and `/issues/search?q=`: your open Linear issues
 * as a board or list with Linear's filters, and one issue as a page.
 */

import { type ReactNode, useEffect } from "react";
import {
  applyFilters,
  boardCell,
  boardColumns,
  boardLanes,
  byPriority,
  issueCardData,
  type IssueScope,
  issuesEmptyText,
  isColumnHidden,
  sessionForIssue,
} from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  Icons,
  IssueBoardView,
  IssueListView,
  IssueSearchField,
  SegmentedControl,
  Spinner,
} from "@argus/peacock";
import type { LinearIssue } from "@argus/remote-protocol";
import { appNavigate } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useConnectionStore } from "../../stores/connection";
import {
  linearConnected,
  useIntegrationsStore,
} from "../../stores/integrations";
import {
  type IssuesLayout,
  setColumnHidden,
  setIssuesLayout,
  useIssuesStore,
} from "../../stores/issues";
import { useProjectsStore } from "../../stores/projects";
import { IssueScreen } from "./IssueScreen";
import { IssuesFilterRow } from "./IssuesFilterRow";
import { useIssueResults } from "./useIssueResults";

export type IssuesScreenState = Extract<Screen, { name: "issues" }>;

const SCOPES = [
  { value: "assigned" as const, label: "Assigned" },
  { value: "created" as const, label: "Created" },
  { value: "subscribed" as const, label: "Subscribed" },
];

const LAYOUTS = [
  { value: "board" as const, label: "Board" },
  { value: "list" as const, label: "List" },
];

function useSessionsOnIt() {
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const sessions = Object.values(sessionsByRepo).flat();

  return (issue: LinearIssue) =>
    issueCardData(issue, sessionForIssue(issue, sessions) !== null);
}

function IssuesContent({
  issues,
  layout,
  onOpen,
}: {
  issues: LinearIssue[];
  layout: IssuesLayout;
  onOpen: (identifier: string) => void;
}) {
  const card = useSessionsOnIt();
  const overrides = useIssuesStore((s) => s.columnOverrides);
  const statesByTeam = useIssuesStore((s) => s.statesByTeam);
  if (layout === "list") {
    return (
      <IssueListView
        sections={boardColumns(issues).map((c) => ({
          id: c.id,
          name: c.name,
          cards: [...c.issues].sort(byPriority).map(card),
        }))}
        selected={null}
        onOpen={onOpen}
      />
    );
  }
  const teams = [...new Set(issues.map((i) => i.teamId))];
  const all = boardColumns(
    issues,
    teams.flatMap((id) => statesByTeam[id] ?? []),
  );
  const columns = all.filter((c) => !isColumnHidden(c, overrides));
  const view = (c: (typeof all)[number]) => ({ ...c, count: c.issues.length });

  return (
    <IssueBoardView
      cards={(priority, id) => {
        const column = columns.find((c) => c.id === id);

        return column ? boardCell(column, priority).map(card) : [];
      }}
      columns={columns.map(view)}
      hiddenColumns={all.filter((c) => isColumnHidden(c, overrides)).map(view)}
      lanes={boardLanes(columns.flatMap((c) => c.issues))}
      selected={null}
      onHideColumn={(id) => setColumnHidden(id, true)}
      onOpen={onOpen}
      onShowColumn={(id) => setColumnHidden(id, false)}
    />
  );
}

function IssuesList({ screen }: { screen: IssuesScreenState }) {
  const { scope, query } = screen;
  const results = useIssueResults(scope, query);
  const filters = useIssuesStore((s) => s.filters[scope]);
  const layout = useIssuesStore((s) => s.layout);
  const data = results.data && applyFilters(results.data, filters);
  const go = (next: Partial<IssuesScreenState>, replace = false) =>
    appNavigate({ ...screen, issueRef: null, ...next }, { replace });

  let content: ReactNode;
  if (data === null && results.error) {
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't fetch issues"
        body={results.error}
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
    const empty = issuesEmptyText(scope, query, filters.length > 0);
    content = (
      <EmptyState
        icon={<Icons.CheckIcon size={20} />}
        title={empty.title}
        body={empty.body}
      />
    );
  } else {
    content = (
      <IssuesContent
        issues={data}
        layout={layout}
        onOpen={(identifier) => go({ issueRef: identifier })}
      />
    );
  }

  return (
    <div className="aw-issues">
      <div className="aw-issues-toolbar">
        <SegmentedControl<IssueScope>
          aria-label="Whose issues"
          options={SCOPES}
          value={scope}
          onChange={(next) => go({ scope: next, query: null })}
        />
        <IssueSearchField
          key={scope === "search" ? "search" : "scope"}
          query={query}
          onSearch={(term, replace) =>
            term
              ? go({ scope: "search", query: term }, replace)
              : go({ scope: "assigned", query: null }, true)
          }
        />
        <SegmentedControl<IssuesLayout>
          aria-label="Layout"
          options={LAYOUTS}
          value={layout}
          onChange={setIssuesLayout}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={results.loading}
          leading={<Icons.RefreshIcon size={12} />}
          onClick={() => {
            results.refresh().catch(() => {});
          }}
        >
          {results.loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {results.data && results.error && (
        <Banner tone="warning">{results.error}</Banner>
      )}
      {results.data && <IssuesFilterRow issues={results.data} scope={scope} />}
      {content}
    </div>
  );
}

export default function IssuesScreen({
  screen,
}: {
  screen: IssuesScreenState;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const integrations = useIntegrationsStore((s) => s.integrations);
  const loaded = useIntegrationsStore((s) => s.integrationsLoad.loaded);
  const refreshIntegrations = useIntegrationsStore(
    (s) => s.refreshIntegrations,
  );

  useEffect(() => {
    if (connection === "ready") {
      refreshIntegrations({ background: true }).catch(() => {});
    }
  }, [connection, refreshIntegrations]);

  if (!linearConnected(integrations)) {
    return loaded ? (
      <EmptyState
        icon={<Icons.LinearIcon size={20} />}
        title="Linear isn't connected"
        body="Connect Linear in Argus on your computer to see your issues by status and priority, read them in full, and start agents on them."
      />
    ) : (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  }

  return screen.issueRef ? (
    <IssueScreen screen={screen} issueRef={screen.issueRef} />
  ) : (
    <IssuesList screen={screen} />
  );
}
