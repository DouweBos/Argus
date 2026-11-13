/**
 * Each session's pull request (GitHub) or merge request (GitLab), looked up by
 * branch head and pushed to clients as a `session:updated` patch.
 *
 * Every (repo slug, branch) pair across all open projects goes into one
 * aliased GraphQL query per host (chunked at {@link PAIRS_PER_QUERY}), so a
 * refresh costs one `gh` / `glab` call however many sessions there are.
 * Lookups degrade silently: a missing or signed-out CLI, or no code-host
 * remote, just means no PR.
 */

import type { RepoRef } from "../codeHost/remoteUrl";
import type { Session, SessionPullRequest } from "../session/models";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addHostEventSink, emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { hostPlatform } from "../../platform";
import { appState } from "../../state";
import { gitlabRepoRefs } from "../codeHost/repos";
import { GlabUnavailable } from "../gitlab/glab";
import { lookupSessionMergeRequests } from "../gitlab/mergeRequests";
import { isBranchProtected } from "../session/argusConfig";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { isPullRequestWatched } from "./prWatch/watched";
import { getGithubSlugs } from "./pullRequests";

const execFileAsync = promisify(execFile);

const PAIRS_PER_QUERY = 40;
const DEBOUNCE_MS = 1500;
const TICK_MS = 30_000;
/** Full refresh cadence while an Argus window has focus. */
const FOREGROUND_INTERVAL_MS = 3 * 60_000;
/** Phones may still be watching; GitHub state changes slowly. */
const BACKGROUND_INTERVAL_MS = 15 * 60_000;
/** Coming back to the window refreshes, unless the last one was this recent. */
const FOCUS_MIN_GAP_MS = 60_000;
/** After a CLI fails outright (missing, signed out), stop asking it for a while. */
const FAILURE_BACKOFF_MS = 15 * 60_000;

interface PrNode {
  createdAt: string;
  headRepository: { nameWithOwner: string } | null;
  isDraft: boolean;
  number: number;
  state: "CLOSED" | "MERGED" | "OPEN";
  url: string;
}

/** One alias in the batched query: a slug's PRs whose head is `branch`. */
export interface PrLookup {
  branch: string;
  name: string;
  owner: string;
}

const cache = new Map<string, SessionPullRequest | null>();

export function sessionPullRequest(
  sessionId: string,
): SessionPullRequest | null {
  return cache.get(sessionId) ?? null;
}

/** The session with its cached PR attached, for listings. */
export function withSessionPullRequest(session: Session): Session {
  return {
    ...session,
    pull_request: sessionPullRequest(session.id),
    pull_request_watched: isPullRequestWatched(session.id),
  };
}

/** Sessions on a branch a PR could be opened from. */
function lookupBranch(session: Session): string | null {
  if (session.kind !== "worktree" && session.kind !== "project_root") {
    return null;
  }
  if (
    session.availability === "unavailable" ||
    session.status === "deleting" ||
    !session.branch ||
    session.branch === "HEAD"
  ) {
    return null;
  }
  // A trunk is a PR's base, not its head: `main` would match fork PRs.
  if (
    session.branch === session.base_branch ||
    isBranchProtected(session.repo_root, session.branch)
  ) {
    return null;
  }

  return session.branch;
}

export function buildPullRequestQuery(lookups: PrLookup[]): {
  query: string;
  variables: string[];
} {
  const decls: string[] = [];
  const fields: string[] = [];
  const variables: string[] = [];
  lookups.forEach((l, i) => {
    decls.push(`$o${i}: String!, $n${i}: String!, $h${i}: String!`);
    fields.push(
      `q${i}: repository(owner: $o${i}, name: $n${i}) { pullRequests(headRefName: $h${i}, first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number url state isDraft createdAt headRepository { nameWithOwner } } } }`,
    );
    variables.push(`o${i}=${l.owner}`, `n${i}=${l.name}`, `h${i}=${l.branch}`);
  });

  return {
    query: `query(${decls.join(", ")}) { ${fields.join(" ")} }`,
    variables,
  };
}

export function toSessionPullRequest(node: PrNode): SessionPullRequest {
  let state: SessionPullRequest["state"] = "closed";
  if (node.state === "MERGED") {
    state = "merged";
  } else if (node.state === "OPEN") {
    state = node.isDraft ? "draft" : "open";
  }

  return { number: node.number, state, url: node.url };
}

/**
 * The newest PR among a branch's candidates whose head lives in one of the
 * project's own repos — a fork's same-named branch is someone else's work.
 */
export function pickPullRequest(
  nodes: PrNode[],
  slugs: string[],
): SessionPullRequest | null {
  const own = new Set(slugs.map((s) => s.toLowerCase()));
  const newest = nodes
    .filter((n) => {
      const head = n.headRepository?.nameWithOwner.toLowerCase();

      return head !== undefined && own.has(head);
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  return newest ? toSessionPullRequest(newest) : null;
}

class GhUnavailable extends Error {}

/** Raw stdout even when GraphQL reports partial errors (`gh` exits 1). */
async function runQuery(
  lookups: PrLookup[],
): Promise<Record<string, { pullRequests?: { nodes: PrNode[] } } | null>> {
  const { query, variables } = buildPullRequestQuery(lookups);
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const v of variables) {
    args.push("-f", v);
  }
  let stdout: string;
  try {
    stdout = (await execFileAsync("gh", args, { maxBuffer: 10 * 1024 * 1024 }))
      .stdout;
  } catch (e) {
    const err = e as { code?: unknown; stdout?: string };
    if (err.code === "ENOENT" || !err.stdout) {
      throw new GhUnavailable(String(e));
    }
    stdout = err.stdout;
  }
  const parsed = JSON.parse(stdout) as {
    data?: Record<string, { pullRequests?: { nodes: PrNode[] } } | null>;
  };
  if (!parsed.data) {
    throw new GhUnavailable(stdout.slice(0, 200));
  }

  return parsed.data;
}

function publish(session: Session, pr: SessionPullRequest | null): void {
  const prev = cache.get(session.id);
  cache.set(session.id, pr);
  if (
    prev !== undefined &&
    prev?.number === pr?.number &&
    prev?.state === pr?.state &&
    prev?.url === pr?.url
  ) {
    return;
  }
  if (prev === undefined && pr === null) {
    return;
  }
  emitHostEvent("session:updated", {
    id: session.id,
    repo_root: session.repo_root,
    pull_request: pr,
  });
}

type HostKind = RepoRef["kind"];

const backoffUntil: Record<HostKind, number> = { github: 0, gitlab: 0 };
let lastFullRefresh = 0;
let wasForeground = false;
let running: Promise<void> | null = null;
const pending = new Set<string>();
let debounce: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let removeSink: (() => void) | null = null;
let initial: ReturnType<typeof setTimeout> | null = null;

interface Target {
  branch: string;
  session: Session;
}

/** The newest GitHub PR per target. One `gh` call per 40 (slug, branch) pairs. */
async function lookupGithub(
  targets: (Target & { slugs: string[] })[],
): Promise<(SessionPullRequest | null)[]> {
  const lookups = new Map<string, PrLookup>();
  for (const { branch, slugs } of targets) {
    for (const slug of slugs) {
      const [owner, name] = slug.split("/");
      lookups.set(`${slug.toLowerCase()}\0${branch}`, { owner, name, branch });
    }
  }
  const keys = [...lookups.keys()];
  const nodesByKey = new Map<string, PrNode[]>();
  for (let i = 0; i < keys.length; i += PAIRS_PER_QUERY) {
    const chunk = keys.slice(i, i + PAIRS_PER_QUERY);
    const data = await runQuery(chunk.map((k) => lookups.get(k)!));
    chunk.forEach((key, j) => {
      const repo = data[`q${j}`];
      // A repo the user can't read comes back null; it has no PRs to show.
      nodesByKey.set(key, repo?.pullRequests?.nodes ?? []);
    });
  }

  return targets.map(({ branch, slugs }) =>
    pickPullRequest(
      slugs.flatMap(
        (slug) => nodesByKey.get(`${slug.toLowerCase()}\0${branch}`) ?? [],
      ),
      slugs,
    ),
  );
}

/** `kind:success` pairs already reported this run: once each is enough to see who uses which host. */
const reported = new Set<string>();

function reportLookup(kind: HostKind, success: boolean): void {
  const key = `${kind}:${success}`;
  if (!reported.has(key)) {
    reported.add(key);
    telemetryCapture("code_host_lookup", { host: kind, success });
  }
}

/** Run one host's lookup, backing off from it alone when its CLI can't answer. */
async function lookupOn<T extends Target>(
  kind: HostKind,
  targets: T[],
  lookup: (targets: T[]) => Promise<(SessionPullRequest | null)[]>,
): Promise<void> {
  if (targets.length === 0 || Date.now() < backoffUntil[kind]) {
    return;
  }
  let found: (SessionPullRequest | null)[];
  try {
    found = await lookup(targets);
  } catch (e) {
    if (e instanceof GhUnavailable || e instanceof GlabUnavailable) {
      reportLookup(kind, false);
      if (backoffUntil[kind] === 0) {
        warn(
          `Session PR lookup unavailable on ${kind} (CLI missing or signed out)`,
        );
      }
      backoffUntil[kind] = Date.now() + FAILURE_BACKOFF_MS;

      return;
    }
    throw e;
  }
  reportLookup(kind, true);
  targets.forEach(({ session, branch }, i) => {
    // The session may have gone, or moved branch, while the query ran.
    const live = appState.sessions.get(session.id);
    if (live && live.branch === branch) {
      publish(live, found[i] ?? null);
    }
  });
}

/** Look up every session in these repos, on each host its remotes live on. */
export async function refreshRepoPullRequests(
  repoRoots: string[],
): Promise<void> {
  const github: (Target & { slugs: string[] })[] = [];
  const gitlab: (Target & { refs: RepoRef[] })[] = [];
  for (const root of new Set(repoRoots)) {
    const sessions = [...appState.sessions.values()].filter(
      (s) => s.repo_root === root,
    );
    if (sessions.length === 0) {
      continue;
    }
    const slugs = await getGithubSlugs(root);
    const refs = await gitlabRepoRefs(root);
    for (const session of sessions) {
      const branch = lookupBranch(session);
      if (!branch || (slugs.length === 0 && refs.length === 0)) {
        publish(session, null);
      } else if (slugs.length > 0) {
        github.push({ session, branch, slugs });
      } else {
        gitlab.push({ session, branch, refs });
      }
    }
  }

  await lookupOn("github", github, lookupGithub);
  await lookupOn("gitlab", gitlab, lookupSessionMergeRequests);
}

function allRepoRoots(): string[] {
  return [...new Set([...appState.sessions.values()].map((s) => s.repo_root))];
}

async function drain(): Promise<void> {
  while (pending.size > 0) {
    const roots = [...pending];
    pending.clear();
    try {
      await refreshRepoPullRequests(roots);
    } catch (e) {
      warn("Session PR lookup failed:", e);
    }
  }
}

/**
 * Queue a lookup for these repos (all when omitted), debounced. `force`
 * clears the failure backoff — something just proved the CLI works.
 */
export function requestSessionPullRequestRefresh(
  repoRoots?: string[],
  { force = false }: { force?: boolean } = {},
): void {
  if (force) {
    backoffUntil.github = 0;
    backoffUntil.gitlab = 0;
  } else if (
    Date.now() < backoffUntil.github &&
    Date.now() < backoffUntil.gitlab
  ) {
    return;
  }
  const roots = repoRoots ?? allRepoRoots();
  if (!repoRoots) {
    lastFullRefresh = Date.now();
  }
  for (const root of roots) {
    pending.add(root);
  }
  if (debounce) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => {
    debounce = null;
    running ??= drain().finally(() => {
      running = null;
      // Requests that landed after the drain loop exited.
      if (pending.size > 0) {
        requestSessionPullRequestRefresh([...pending]);
      }
    });
  }, DEBOUNCE_MS);
}

/** After a push or a PR action from Argus: look again now, the CLI evidently works. */
export function sessionPullRequestMayHaveChanged(sessionId?: string): void {
  const root = sessionId
    ? appState.sessions.get(sessionId)?.repo_root
    : undefined;
  requestSessionPullRequestRefresh(root ? [root] : undefined, { force: true });
}

function tick(): void {
  const foreground = hostPlatform().isForeground();
  const since = Date.now() - lastFullRefresh;
  const due =
    since >= (foreground ? FOREGROUND_INTERVAL_MS : BACKGROUND_INTERVAL_MS) ||
    (foreground && !wasForeground && since >= FOCUS_MIN_GAP_MS);
  wasForeground = foreground;
  if (due) {
    requestSessionPullRequestRefresh();
  }
}

/** Channels after which a session's PR may have changed. */
function onHostEvent(channel: string, args: unknown[]): void {
  const payload = args[0] as
    | string
    | { branch?: unknown; id?: unknown; repo_root?: unknown }
    | undefined;
  if (channel === "session:deleted" && typeof payload === "string") {
    cache.delete(payload);

    return;
  }
  if (channel === "project:added" && typeof payload === "string") {
    requestSessionPullRequestRefresh([payload]);

    return;
  }
  if (!payload || typeof payload !== "object") {
    return;
  }
  let root: string | undefined;
  if (typeof payload.repo_root === "string") {
    root = payload.repo_root;
  } else if (typeof payload.id === "string") {
    root = appState.sessions.get(payload.id)?.repo_root;
  }
  if (!root) {
    return;
  }
  // Our own patches carry no branch, so they don't loop back here.
  const relevant =
    channel === "session:created" ||
    channel === "session:merged" ||
    (channel === "session:updated" && typeof payload.branch === "string");
  if (relevant) {
    requestSessionPullRequestRefresh([root]);
  }
}

export function startSessionPullRequests(): void {
  if (ticker) {
    return;
  }
  removeSink = addHostEventSink(onHostEvent);
  ticker = setInterval(tick, TICK_MS);
  ticker.unref?.();
  // Projects restore before this runs; give their listings a moment.
  initial = setTimeout(() => requestSessionPullRequestRefresh(), 5_000);
  initial.unref?.();
}

export function stopSessionPullRequests(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (debounce) {
    clearTimeout(debounce);
    debounce = null;
  }
  if (initial) {
    clearTimeout(initial);
    initial = null;
  }
  removeSink?.();
  removeSink = null;
  pending.clear();
}

/** Test-only. */
export function resetSessionPullRequests(): void {
  stopSessionPullRequests();
  cache.clear();
  reported.clear();
  backoffUntil.github = 0;
  backoffUntil.gitlab = 0;
  lastFullRefresh = 0;
  wasForeground = false;
}
