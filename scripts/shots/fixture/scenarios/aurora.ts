/**
 * The demo world every scenario shares: one fictional project, five tasks.
 *
 * Names and paths are invented on purpose — these images get published, so
 * nothing here may resemble a real repo, path or person.
 */

export const REPO = "/Users/dev/Projects/Aurora";

/**
 * Anchored to the run, not to a calendar date. The UI renders relative times
 * ("4h ago"), so a fixed timestamp drifts further from the real clock every day
 * and `pnpm shots --check` would start failing on its own.
 */
export const NOW = Date.now();

const HOURS = 60 * 60_000;

/** Where the demo workspace sits in time, so every shot tells the same story. */
const OPENED_AT = NOW - 4 * HOURS;

export interface Task {
  agent: "idle" | "requires_action" | "running";
  branch: string;
  description: string;
  id: string;
  name: string;
}

export const TASKS: Task[] = [
  {
    agent: "running",
    branch: "offline-playback",
    description: "Cache downloaded episodes for airplane mode",
    id: "ses_offline",
    name: "Offline playback",
  },
  {
    agent: "running",
    branch: "search-rewrite",
    description: "Replace the search index with a trigram matcher",
    id: "ses_search",
    name: "Search rewrite",
  },
  {
    agent: "requires_action",
    branch: "onboarding-polish",
    description: "Tighten the first-run flow and add skip affordances",
    id: "ses_onboarding",
    name: "Onboarding polish",
  },
  {
    agent: "running",
    branch: "home-widgets",
    description: "Ship the iOS 18 lock-screen widget set",
    id: "ses_widgets",
    name: "Home widgets",
  },
  {
    agent: "idle",
    branch: "crash-triage",
    description: "Chase the Sentry spike on the player screen",
    id: "ses_crash",
    name: "Crash triage",
  },
];

export function worktreePath(branch: string): string {
  return `/Users/dev/.argus/worktrees/Aurora-argus-worktrees/${branch}`;
}

export function session(task: Task) {
  return {
    base_branch: "main",
    branch: task.branch,
    description: task.description,
    display_name: task.name,
    id: task.id,
    kind: "worktree" as const,
    path: worktreePath(task.branch),
    repo_root: REPO,
    runner_id: "claude-code",
    status: "ready" as const,
  };
}

export const ROOT_SESSION = {
  branch: "main",
  description: "Aurora",
  id: "ses_root",
  kind: "project_root" as const,
  path: REPO,
  repo_root: REPO,
  status: "ready" as const,
};

export const SESSIONS = [ROOT_SESSION, ...TASKS.map(session)];

export function agent(task: Task, index: number) {
  return {
    agent_id: `agt_${task.id}`,
    created_at: NOW - (index + 1) * 6 * 60_000,
    model: "claude-opus-5-5",
    parent_agent_id: null,
    permission_mode: "default",
    session_id: task.id,
    status: task.agent,
  };
}

export const AGENTS = TASKS.map(agent);

export function device(task: Task, index: number) {
  return {
    agentId: `agt_${task.id}`,
    deviceKey: `ios-${task.id}`,
    name: index % 2 === 0 ? "iPhone 17 Pro" : "Pixel 9",
    online: true,
    platform: index % 2 === 0 ? ("ios" as const) : ("android" as const),
    repoRoot: REPO,
    reservationKey: task.id,
    reserved: true,
    runtime: index % 2 === 0 ? "iOS 26.0" : "Android 16",
    sessionId: task.id,
    sessionPath: worktreePath(task.branch),
  };
}

export const DEVICES = TASKS.slice(0, 4).map(device);

export const PROJECTS = [
  { description: "Aurora", path: REPO, registered: true, source: "user" },
];

/** Every setup nag dismissed: they describe a fresh install, not this workspace. */
export const BASE_STORAGE: Record<string, unknown> = {
  "argus:setup-cards-dismissed": [
    "claude",
    "conductor",
    "notifications",
    "xcode",
  ],
  "argus:openProjects": [{ addedAt: OPENED_AT, hostId: "local", path: REPO }],
  "argus:recentProjects": [
    { hostId: "local", lastOpened: OPENED_AT, name: "Aurora", path: REPO },
  ],
};

/** The channels every scenario needs to render the shell and sidebar. */
export const BASE_CHANNELS: Record<string, unknown> = {
  list_projects: PROJECTS,
  list_sessions: SESSIONS,
  list_devices: DEVICES,
};
