/**
 * The pull requests the computer's `gh` says are yours to look at, and the
 * ones you opened. Mirrors ArgusCore's `PullRequestsStore`: reading is
 * `monitor`; opening, merging, commenting and Claude's fill need `control`.
 * Cleared whenever the computer changes: another one answers for other repos.
 */

import type { RemotePullRequest, RemotePullRequestDetail } from "@argus/remote-protocol";
import { create } from "zustand";
import {
  describeError,
  explainPullRequestError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
  NOT_CONNECTED_MESSAGE,
  type PrMergeStrategy,
} from "@argus/client-core";
import { RemoteError, type Transport } from "@argus/remote-client";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import type { RefreshOptions } from "./projects";

/** `owner/repo#12`, as ArgusKit keys a detail. */
export function pullRequestKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

interface PullRequestsState {
  pullRequests: RemotePullRequest[];
  load: LoadState;
  detailById: Record<string, RemotePullRequestDetail>;
  /** Why the last detail read failed, per PR. */
  detailErrorById: Record<string, string>;

  refresh: (options?: RefreshOptions) => Promise<void>;
  loadDetail: (
    repo: string,
    number: number,
    options?: RefreshOptions,
  ) => Promise<void>;
  /** The new PR's url. The computer works out base and head from the session. */
  create: (
    sessionId: string,
    title: string,
    body: string,
    draft: boolean,
  ) => Promise<string>;
  merge: (repo: string, number: number, strategy: PrMergeStrategy) => Promise<void>;
  comment: (repo: string, number: number, body: string) => Promise<void>;
}

function transport(): Transport {
  const t = currentTransport();
  if (!t) {
    throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
  }

  return t;
}

/** `gh` missing or signed out reads as how to fix it. */
function explain(err: unknown): string {
  return explainPullRequestError(describeError(err));
}

const EMPTY = {
  pullRequests: [],
  load: INITIAL_LOAD,
  detailById: {},
  detailErrorById: {},
} satisfies Partial<PullRequestsState>;

export const usePullRequestsStore = create<PullRequestsState>()((set, get) => ({
  ...EMPTY,

  refresh: async (options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { pull_requests } = await request(t, "github.pull_requests", {});
      set({ pullRequests: pull_requests, load: { loaded: true, error: null } });
    } catch (err) {
      if (!isQuietError(err, options?.background ?? false)) {
        set({ load: { loaded: true, error: explain(err) } });
      }
    }
  },

  loadDetail: async (repo, number, options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const key = pullRequestKey(repo, number);
    try {
      const { pull_request } = await request(t, "github.pull_request", {
        repo,
        number,
      });
      set((s) => {
        const errors = { ...s.detailErrorById };
        delete errors[key];

        return {
          detailById: { ...s.detailById, [key]: pull_request },
          detailErrorById: errors,
        };
      });
    } catch (err) {
      if (!isQuietError(err, options?.background ?? false)) {
        set((s) => ({
          detailErrorById: { ...s.detailErrorById, [key]: explain(err) },
        }));
      }
    }
  },

  create: async (sessionId, title, body, draft) => {
    try {
      const { url } = await request(transport(), "github.create_pull_request", {
        session_id: sessionId,
        title,
        body,
        draft,
      });
      capture("web_pull_request_acted", { action: "open" });
      void get()
        .refresh({ background: true })
        .catch(() => {});

      return url;
    } catch (err) {
      throw new Error(explain(err));
    }
  },

  merge: async (repo, number, strategy) => {
    try {
      await request(transport(), "github.merge_pull_request", {
        repo,
        number,
        strategy,
      });
      capture("web_pull_request_acted", { action: "merge" });
    } catch (err) {
      throw new Error(explain(err));
    } finally {
      void get().loadDetail(repo, number, { background: true });
      void get().refresh({ background: true });
    }
  },

  comment: async (repo, number, body) => {
    try {
      await request(transport(), "github.comment_pull_request", {
        repo,
        number,
        body,
      });
      capture("web_pull_request_acted", { action: "comment" });
    } catch (err) {
      throw new Error(explain(err));
    }
    void get().loadDetail(repo, number, { background: true });
  },
}));

export function resetPullRequests(): void {
  usePullRequestsStore.setState(EMPTY);
}

/** The repo's PR template; null when it has none or the computer can't say. */
export async function pullRequestTemplate(
  sessionId: string,
): Promise<string | null> {
  const t = currentTransport();
  if (!t) {
    return null;
  }

  return request(t, "github.pull_request_template", { session_id: sessionId })
    .then((r) => r.template)
    .catch(() => null);
}

/** Claude's description from the session's commits and diff; null when it couldn't. */
export async function fillPullRequest(
  sessionId: string,
  title: string,
): Promise<string | null> {
  const { body } = await request(transport(), "github.fill_pull_request", {
    session_id: sessionId,
    title,
  });
  capture("web_pull_request_acted", { action: "fill" });

  return body;
}
