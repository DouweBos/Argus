import type {
  LinearIssue,
  LinearIssueDetail,
  LinearIssueScope,
  LinearWorkflowState,
} from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { useIpcEvent } from "../hooks/useIpcEvent";
import {
  commentOnLinearIssue,
  getLinearIssue,
  listIntegrations,
  listLinearIssues,
  listLinearTeamStates,
  updateLinearIssue,
} from "../lib/ipc";

const POLL_MS = 5 * 60 * 1000;
const LIMIT = 150;
const LAYOUT_KEY = "argus:issues-layout";

export type IssuesLayout = "board" | "list";

interface ScopeList {
  /** Null until the first fetch lands. */
  data: LinearIssue[] | null;
  error: string | null;
  loading: boolean;
}

interface LinearIssuesState {
  /** Linear is connected and its credential still works. */
  connected: boolean;
  details: Record<string, LinearIssueDetail>;
  layout: IssuesLayout;
  lists: Record<LinearIssueScope, ScopeList>;
  statesByTeam: Record<string, LinearWorkflowState[]>;
}

const EMPTY: ScopeList = { data: null, error: null, loading: false };

function loadLayout(): IssuesLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

const store = create<LinearIssuesState>(() => ({
  connected: false,
  details: {},
  layout: loadLayout(),
  lists: { assigned: EMPTY, created: EMPTY, subscribed: EMPTY },
  statesByTeam: {},
}));

function patchList(scope: LinearIssueScope, patch: Partial<ScopeList>): void {
  store.setState((s) => ({
    lists: { ...s.lists, [scope]: { ...s.lists[scope], ...patch } },
  }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const inFlight = new Map<LinearIssueScope, Promise<void>>();

export function refreshLinearIssues(
  scope: LinearIssueScope = "assigned",
): Promise<void> {
  const running = inFlight.get(scope);
  if (running) {
    return running;
  }
  patchList(scope, { loading: true });
  const request = listLinearIssues(null, LIMIT, scope)
    .then((data) => patchList(scope, { data, error: null }))
    .catch((err: unknown) => patchList(scope, { error: message(err) }))
    .finally(() => {
      patchList(scope, { loading: false });
      inFlight.delete(scope);
    });
  inFlight.set(scope, request);

  return request;
}

/** Swap an updated issue into every list and cached detail that holds it. */
function replaceIssue(issue: LinearIssue): void {
  store.setState((s) => {
    const lists = { ...s.lists };
    for (const scope of Object.keys(lists) as LinearIssueScope[]) {
      const data = lists[scope].data;
      if (data?.some((i) => i.id === issue.id)) {
        lists[scope] = {
          ...lists[scope],
          data: data.map((i) => (i.id === issue.id ? issue : i)),
        };
      }
    }
    const cached = s.details[issue.identifier];
    const details = cached
      ? { ...s.details, [issue.identifier]: { ...cached, ...issue } }
      : s.details;

    return { lists, details };
  });
}

export async function loadLinearIssueDetail(
  ref: string,
): Promise<LinearIssueDetail | null> {
  const detail = await getLinearIssue(ref);
  if (detail) {
    store.setState((s) => ({
      details: { ...s.details, [detail.identifier]: detail },
    }));
  }

  return detail;
}

export async function loadTeamStates(
  teamId: string,
): Promise<LinearWorkflowState[]> {
  const cached = store.getState().statesByTeam[teamId];
  if (cached) {
    return cached;
  }
  const states = await listLinearTeamStates(teamId);
  store.setState((s) => ({
    statesByTeam: { ...s.statesByTeam, [teamId]: states },
  }));

  return states;
}

export async function changeLinearIssue(
  issueId: string,
  change: { priority?: number; stateId?: string },
): Promise<void> {
  replaceIssue(await updateLinearIssue(issueId, change));
}

export async function postLinearComment(
  issue: LinearIssue,
  body: string,
): Promise<void> {
  await commentOnLinearIssue(issue.id, body);
  await loadLinearIssueDetail(issue.identifier);
}

export function setIssuesLayout(layout: IssuesLayout): void {
  store.setState({ layout });
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // storage unavailable
  }
}

async function refreshConnection(): Promise<void> {
  const all = await listIntegrations().catch(() => []);
  const connected = all.some(
    (s) => s.id === "linear" && s.connected && !s.needsReauth,
  );
  store.setState(
    connected
      ? { connected }
      : {
          connected,
          details: {},
          lists: { assigned: EMPTY, created: EMPTY, subscribed: EMPTY },
        },
  );
  if (connected) {
    await refreshLinearIssues("assigned");
  }
}

/** Keeps the assigned-issue list fresh while Linear is connected. Mount once. */
export function useLinearIssuesSync(): void {
  useEffect(() => {
    refreshConnection().catch(() => undefined);
    const timer = setInterval(() => {
      if (store.getState().connected) {
        refreshLinearIssues("assigned").catch(() => undefined);
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, []);
  useIpcEvent("integration_status_changed", () => {
    refreshConnection().catch(() => undefined);
  });
}

export const useLinearConnected = () => store((s) => s.connected);
export const useLinearIssueList = (scope: LinearIssueScope) =>
  store((s) => s.lists[scope]);
export const useLinearIssueDetail = (ref: string | null) =>
  store((s) => (ref ? (s.details[ref] ?? null) : null));
export const useTeamStates = (teamId: string | null) =>
  store((s) => (teamId ? (s.statesByTeam[teamId] ?? null) : null));
export const useIssuesLayout = () => store((s) => s.layout);
