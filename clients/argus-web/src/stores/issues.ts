/**
 * Linear issues as the computer's connected user sees them: each scope's
 * list, the workspace search, issue details with their team's workflow, and
 * the filters and layout this browser keeps. Mirrors ArgusCore's
 * `LinearIssuesModel`; the host captures `linear_issue_updated`, so updates
 * and comments count nothing here.
 */

import { create } from "zustand";
import {
  describeError,
  type IssueFilter,
  issueResultsBucket,
  type IssueScope,
  isQuietError,
} from "@argus/client-core";
import type {
  LinearIssue,
  LinearIssueDetail,
  LinearIssueScope,
  LinearWorkflowState,
} from "@argus/remote-protocol";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";

export type IssuesLayout = "board" | "list";

export interface IssueList {
  /** Null until the first fetch lands. */
  data: LinearIssue[] | null;
  error: string | null;
  loading: boolean;
}

interface IssueSearch extends IssueList {
  /** What `data` answers; a newer term replaces it. */
  term: string | null;
}

interface IssuesState {
  /** Board columns shown (false) or hidden (true) against the defaults. */
  columnOverrides: Record<string, boolean>;
  details: Record<string, LinearIssueDetail>;
  /** Active filters per scope, like a saved Linear view. */
  filters: Record<IssueScope, IssueFilter[]>;
  layout: IssuesLayout;
  lists: Record<LinearIssueScope, IssueList>;
  search: IssueSearch;
  statesByTeam: Record<string, LinearWorkflowState[]>;
}

const LIMIT = 100;
const SEARCH_LIMIT = 50;
const FILTERS_KEY = "argus-web:issues-filters";
const LAYOUT_KEY = "argus-web:issues-layout";
const COLUMNS_KEY = "argus-web:issues-columns";
const EMPTY_LIST: IssueList = { data: null, error: null, loading: false };
const NO_FILTERS: Record<IssueScope, IssueFilter[]> = {
  assigned: [],
  created: [],
  search: [],
  subscribed: [],
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);

    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the choice lasts as long as the page.
  }
}

function hostState() {
  return {
    details: {},
    lists: {
      assigned: EMPTY_LIST,
      created: EMPTY_LIST,
      subscribed: EMPTY_LIST,
    },
    search: { ...EMPTY_LIST, term: null },
    statesByTeam: {},
  } satisfies Partial<IssuesState>;
}

export const useIssuesStore = create<IssuesState>()(() => ({
  ...hostState(),
  columnOverrides: loadJson<Record<string, boolean>>(COLUMNS_KEY, {}),
  filters: { ...NO_FILTERS, ...loadJson(FILTERS_KEY, {}) },
  layout: loadJson<string>(LAYOUT_KEY, "board") === "list" ? "list" : "board",
}));

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

function patchList(scope: LinearIssueScope, patch: Partial<IssueList>): void {
  useIssuesStore.setState((s) => ({
    lists: { ...s.lists, [scope]: { ...s.lists[scope], ...patch } },
  }));
}

const inFlight = new Map<LinearIssueScope, Promise<void>>();

/** A scope's open issues; `background` keeps a dropped connection quiet. */
export function refreshIssues(
  scope: LinearIssueScope,
  options?: { background?: boolean },
): Promise<void> {
  const running = inFlight.get(scope);
  if (running) {
    return running;
  }
  patchList(scope, { loading: true });
  const run = (async () => {
    try {
      const { issues } = await request(connected(), "linear.issues", {
        scope,
        limit: LIMIT,
      });
      patchList(scope, { data: issues, error: null });
    } catch (err) {
      if (!isQuietError(err, options?.background ?? false)) {
        patchList(scope, { error: describeError(err) });
      }
    } finally {
      patchList(scope, { loading: false });
      inFlight.delete(scope);
    }
  })();
  inFlight.set(scope, run);

  return run;
}

let searchSeq = 0;

/** Every issue in the workspace matching `term`; only the latest term's answer lands. */
export async function searchIssues(term: string): Promise<void> {
  const seq = ++searchSeq;
  useIssuesStore.setState((s) => ({
    search: {
      term,
      data: s.search.term === term ? s.search.data : null,
      error: null,
      loading: true,
    },
  }));
  const settle = (patch: Partial<IssueSearch>) => {
    if (seq === searchSeq) {
      useIssuesStore.setState((s) => ({
        search: { ...s.search, ...patch, loading: false },
      }));
    }
  };
  try {
    const { issues } = await request(connected(), "linear.issues", {
      query: term,
      limit: SEARCH_LIMIT,
    });
    settle({ data: issues, error: null });
    if (seq === searchSeq) {
      capture("web_issue_searched", {
        results_bucket: issueResultsBucket(issues.length),
      });
    }
  } catch (err) {
    settle({ error: describeError(err) });
  }
}

/** One issue and its team's workflow; null when Linear has no such issue. */
export async function loadIssue(
  ref: string,
): Promise<LinearIssueDetail | null> {
  const { issue, states } = await request(connected(), "linear.issue", {
    ref,
  });
  if (issue) {
    useIssuesStore.setState((s) => ({
      details: { ...s.details, [issue.identifier]: issue, [ref]: issue },
      statesByTeam:
        states.length > 0
          ? { ...s.statesByTeam, [issue.teamId]: states }
          : s.statesByTeam,
    }));
  }

  return issue;
}

/** Swap an updated issue into every list and cached detail that holds it. */
function replaceIssue(issue: LinearIssue): void {
  const swap = (data: LinearIssue[] | null) =>
    data?.some((i) => i.id === issue.id)
      ? data.map((i) => (i.id === issue.id ? issue : i))
      : data;
  useIssuesStore.setState((s) => {
    const lists = { ...s.lists };
    for (const scope of Object.keys(lists) as LinearIssueScope[]) {
      lists[scope] = { ...lists[scope], data: swap(lists[scope].data) };
    }
    const details = { ...s.details };
    for (const [key, cached] of Object.entries(details)) {
      if (cached.id === issue.id) {
        details[key] = { ...cached, ...issue };
      }
    }

    return {
      lists,
      details,
      search: { ...s.search, data: swap(s.search.data) },
    };
  });
}

/** Move an issue to another status or priority. */
export async function updateIssue(
  issueId: string,
  patch: { priority?: number; stateId?: string },
): Promise<void> {
  const { issue } = await request(connected(), "linear.update_issue", {
    issue_id: issueId,
    ...(patch.stateId ? { state_id: patch.stateId } : {}),
    ...(patch.priority === undefined ? {} : { priority: patch.priority }),
  });
  replaceIssue(issue);
}

/** Comment as the computer's Linear user; `parentId` replies in that thread. */
export async function commentOnIssue(
  issue: Pick<LinearIssue, "id" | "identifier">,
  body: string,
  parentId: string | null,
): Promise<void> {
  await request(connected(), "linear.comment", {
    issue_id: issue.id,
    body,
    ...(parentId ? { parent_id: parentId } : {}),
  });
  await loadIssue(issue.identifier);
}

export function setIssueFilters(
  scope: IssueScope,
  filters: IssueFilter[],
): void {
  useIssuesStore.setState((s) => {
    const next = { ...s.filters, [scope]: filters };
    saveJson(FILTERS_KEY, next);

    return { filters: next };
  });
}

export function setIssuesLayout(layout: IssuesLayout): void {
  saveJson(LAYOUT_KEY, layout);
  useIssuesStore.setState({ layout });
}

export function setColumnHidden(columnId: string, hidden: boolean): void {
  useIssuesStore.setState((s) => {
    const columnOverrides = { ...s.columnOverrides, [columnId]: hidden };
    saveJson(COLUMNS_KEY, columnOverrides);

    return { columnOverrides };
  });
}

/** A new host: its issues aren't the last one's. Filters and layout are this browser's. */
export function resetIssues(): void {
  inFlight.clear();
  searchSeq += 1;
  useIssuesStore.setState(hostState());
}
