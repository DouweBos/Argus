/**
 * In-memory cache for GitHub PR list + detail. Keeps results across
 * navigations so returning to the Pull requests screen or a PR detail
 * view renders instantly from cache while a background refresh happens.
 */

import type { InterestingPullRequest, PullRequestDetail } from "../lib/types";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  getPullRequestDetail,
  getPullRequestDiff,
  listInterestingPullRequests,
} from "../lib/ipc";
import { countAwaitingMyReview } from "../lib/pullRequestBucket";
import { getOpenProjects } from "./recentProjectsStore";
import { useSessionProjects } from "./sessionStore";

interface PrListState {
  data: InterestingPullRequest[] | null;
  error: string | null;
  fetchedAt: number | null;
  loading: boolean;
}

interface PrDetailState {
  data: PullRequestDetail | null;
  error: string | null;
  fetchedAt: number | null;
  loading: boolean;
}

interface PrDiffState {
  data: string | null;
  error: string | null;
  fetchedAt: number | null;
  loading: boolean;
}

interface PullRequestStoreData {
  details: Record<string, PrDetailState>;
  diffs: Record<string, PrDiffState>;
  list: PrListState;
}

const emptyList: PrListState = {
  data: null,
  error: null,
  fetchedAt: null,
  loading: false,
};

const emptyDetail: PrDetailState = {
  data: null,
  error: null,
  fetchedAt: null,
  loading: false,
};

const emptyDiff: PrDiffState = {
  data: null,
  error: null,
  fetchedAt: null,
  loading: false,
};

const store = create<PullRequestStoreData>(() => ({
  list: emptyList,
  details: {},
  diffs: {},
}));

export const usePrList = () => store((s) => s.list);

/** Count of PRs currently classified as "Awaiting my review". Used by the
 *  sidebar nav item to show a badge next to the Pull requests entry. */
export const useAwaitingMyReviewCount = (): number =>
  store((s) => countAwaitingMyReview(s.list.data));
export const usePrDetailState = (key: string | null): PrDetailState =>
  store((s) => (key ? (s.details[key] ?? emptyDetail) : emptyDetail));
export const usePrDiffState = (key: string | null): PrDiffState =>
  store((s) => (key ? (s.diffs[key] ?? emptyDiff) : emptyDiff));

let listInFlight: Promise<void> | null = null;
// Key of the most-recently requested repoRoots set. When a fresh call comes
// in with a different key, we start a new fetch and discard any in-flight
// result that doesn't match this key on completion. This stops the
// classic bug where the first call (e.g. one project still hydrating) wins
// the `listInFlight` slot and later calls with the full project list just
// attach to it and inherit its too-narrow slug filter.
let latestListKey: string | null = null;

function rootsKey(repoRoots: string[]): string {
  return [...repoRoots].sort().join("|");
}

export async function refreshPullRequestList(
  repoRoots: string[],
): Promise<void> {
  const key = rootsKey(repoRoots);
  if (repoRoots.length === 0) {
    const current = store.getState().list;
    // Only reset to an empty list if we had real data before — otherwise
    // we're still in the app-load bootstrap window before projects hydrate
    // and we don't want to flip the UI from "Loading…" to "no PRs of
    // interest" prematurely.
    if (current.data !== null) {
      store.setState({
        list: { data: [], error: null, fetchedAt: Date.now(), loading: false },
      });
    }

    return;
  }
  if (listInFlight && latestListKey === key) {
    return listInFlight;
  }
  latestListKey = key;
  const current = store.getState().list;
  store.setState({
    list: { ...current, loading: true, error: null },
  });
  listInFlight = (async () => {
    try {
      const data = await listInterestingPullRequests(repoRoots);
      // Another, newer call may have superseded us while we were awaiting
      // gh. Only commit if our key still matches the latest requested set.
      if (latestListKey !== key) {
        return;
      }
      store.setState({
        list: {
          data,
          error: null,
          fetchedAt: Date.now(),
          loading: false,
        },
      });
    } catch (err) {
      if (latestListKey !== key) {
        return;
      }
      store.setState({
        list: {
          data: store.getState().list.data,
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: store.getState().list.fetchedAt,
          loading: false,
        },
      });
    } finally {
      // Only clear the in-flight handle if it's still ours. If a newer call
      // replaced it we must not null out the successor's handle.
      if (latestListKey === key) {
        listInFlight = null;
      }
    }
  })();

  return listInFlight;
}

/**
 * Clear the list cache — call after an action that would invalidate it
 * (e.g. the user closes a project, so its repo's PRs should drop).
 */
export function clearPullRequestList(): void {
  store.setState({ list: emptyList });
}

export function detailKey(owner: string, repo: string, number: number): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}/${number}`;
}

const detailsInFlight = new Map<string, Promise<void>>();
const diffsInFlight = new Map<string, Promise<void>>();

export async function refreshPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
): Promise<void> {
  const key = detailKey(owner, repo, number);
  const existing = diffsInFlight.get(key);
  if (existing) {
    return existing;
  }
  const current = store.getState().diffs[key] ?? emptyDiff;
  store.setState({
    diffs: {
      ...store.getState().diffs,
      [key]: { ...current, loading: true, error: null },
    },
  });
  const promise = (async () => {
    try {
      const data = await getPullRequestDiff(owner, repo, number);
      store.setState({
        diffs: {
          ...store.getState().diffs,
          [key]: {
            data,
            error: null,
            fetchedAt: Date.now(),
            loading: false,
          },
        },
      });
    } catch (err) {
      const prev = store.getState().diffs[key] ?? emptyDiff;
      store.setState({
        diffs: {
          ...store.getState().diffs,
          [key]: {
            data: prev.data,
            error: err instanceof Error ? err.message : String(err),
            fetchedAt: prev.fetchedAt,
            loading: false,
          },
        },
      });
    } finally {
      diffsInFlight.delete(key);
    }
  })();
  diffsInFlight.set(key, promise);

  return promise;
}

export async function refreshPullRequestDetail(
  owner: string,
  repo: string,
  number: number,
): Promise<void> {
  const key = detailKey(owner, repo, number);
  const existing = detailsInFlight.get(key);
  if (existing) {
    return existing;
  }
  const current = store.getState().details[key] ?? emptyDetail;
  store.setState({
    details: {
      ...store.getState().details,
      [key]: { ...current, loading: true, error: null },
    },
  });
  const promise = (async () => {
    try {
      const data = await getPullRequestDetail(owner, repo, number);
      store.setState({
        details: {
          ...store.getState().details,
          [key]: {
            data,
            error: null,
            fetchedAt: Date.now(),
            loading: false,
          },
        },
      });
    } catch (err) {
      const prev = store.getState().details[key] ?? emptyDetail;
      store.setState({
        details: {
          ...store.getState().details,
          [key]: {
            data: prev.data,
            error: err instanceof Error ? err.message : String(err),
            fetchedAt: prev.fetchedAt,
            loading: false,
          },
        },
      });
    } finally {
      detailsInFlight.delete(key);
    }
  })();
  detailsInFlight.set(key, promise);

  return promise;
}

/**
 * Poll interval for the background PR-list refresh. Five minutes is a sane
 * default — frequent enough that the "Awaiting my review" badge stays close
 * to GitHub's reality, infrequent enough not to hammer the `gh` CLI.
 */
const PR_LIST_POLL_MS = 5 * 60 * 1000;
/**
 * Debounce window for kicking the first fetch after `repoRoots` changes.
 * `useProjects()` hydrates saved projects one at a time from localStorage —
 * each one flips `repoRootsKey` — so we wait for the churn to settle before
 * firing off to `gh` once with the complete set.
 */
const PR_LIST_HYDRATION_DEBOUNCE_MS = 500;

/**
 * Mount once at the app shell to keep the PR list fresh:
 *  - fetches on app load (first render),
 *  - refetches when the set of open projects changes (so newly opened repos
 *    surface their PRs immediately),
 *  - refetches every 5 minutes in the background.
 *
 * The store's stale-while-revalidate behaviour means the sidebar count and
 * Pull requests screen always have the latest cached data without an extra
 * request when the user navigates there.
 */
export function usePullRequestsSync(): void {
  const projects = useSessionProjects();
  const repoRoots = useMemo(() => projects.map((p) => p.repoRoot), [projects]);
  const repoRootsKey = repoRoots.join("|");

  // Bootstrap the initial list state as soon as the app shell mounts, before
  // `useProjects()` has finished hydrating its list from localStorage. If
  // there are saved projects, mark the store as loading so the Pull requests
  // screen renders its spinner instead of the "no PRs of interest" empty
  // state; if there's nothing saved we settle on an empty list so the
  // correct "open a project" state renders.
  useEffect(() => {
    const saved = getOpenProjects();
    const current = store.getState().list;
    if (current.data !== null || current.loading) {
      return;
    }
    if (saved.length > 0) {
      store.setState({
        list: { data: null, error: null, fetchedAt: null, loading: true },
      });
    } else {
      store.setState({
        list: { data: [], error: null, fetchedAt: Date.now(), loading: false },
      });
    }
  }, []);

  useEffect(() => {
    // Skip the fire-and-poll until at least one project is present. The
    // projects array starts empty and gets populated async from localStorage
    // via `useProjects`; firing a no-op refresh during that window would
    // race ahead of the real set.
    if (repoRoots.length === 0) {
      return;
    }

    // Debounce the first fetch — each hydrating project flips repoRootsKey
    // and re-runs this effect, so we'd otherwise fire off one fetch per
    // project. Waiting 500ms lets the hydration settle and we fetch exactly
    // once with the complete set. The 5-minute poll interval is installed
    // *after* the initial fetch kicks, so it also inherits the final set.
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      refreshPullRequestList(repoRoots).catch(() => {});
      intervalId = setInterval(() => {
        refreshPullRequestList(repoRoots).catch(() => {});
      }, PR_LIST_POLL_MS);
    }, PR_LIST_HYDRATION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
    // repoRootsKey captures identity of the project set; including the array
    // directly would retrigger on every render because of reference churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRootsKey]);
}
