/**
 * What a fixture scenario answers for a host command: its own channel, else a
 * shape-safe default, as the Mac fixture host answers it.
 */

import type { FixtureScenario } from "./types";

/**
 * Channels whose `null` would gate the whole UI — the app never renders past a
 * missing onboarding state, and `UpdaterHost` reads `.phase` unguarded.
 */
const DEFAULTS: Record<string, unknown> = {
  onboarding_get_state: {
    onboarding: {
      completed: true,
      completedAt: 0,
      lastStep: "telemetry",
      skipped: [],
      version: 1,
    },
    recentProjects: [],
  },
  telemetry_get_init: { configured: false, mode: "presence" },
  git_lfs_files: { lfsInstalled: false, repoUsesLfs: false, tracked: [] },
  // A keyed map, not a list — the chat indexes straight into it.
  get_command_metrics: {},
  // Named `..._list` but shaped as an object, so the name heuristic below gets
  // it wrong. Explicit entries win, which is the point of this table.
  claude_accounts_list: { accounts: [], activeId: "" },
  // Every array on `ArgusConfig` has to be present: the session panels read
  // `.length` off them without guarding.
  read_argus_config: {
    setup: { copy: [], symlink: [], commands: [] },
    terminals: [],
    workspace_env: [],
    run: [],
    browser_presets: [],
    related_projects: [],
  },
  git_compare_branches: {
    leftOnly: [],
    mergeBase: null,
    rightOnly: [],
    wouldConflict: false,
  },
  updater_get_state: {
    currentVersion: "0.42.0",
    error: null,
    lastCheckedAt: null,
    phase: "idle",
    progressPercent: 0,
    releaseDate: null,
    releaseNotes: null,
    updateVersion: null,
  },
};

/**
 * Channels that hand back a collection. A `null` here is the single most common
 * way a fixture run dies — the first `.length` or `.map()` throws — and the
 * name alone doesn't always say so (`git_log`, `git_lfs_files`).
 */
const ARRAY_CHANNELS = new Set([
  "git_log",
  "git_list_remotes",
  "git_list_tags",
  "onboarding_check_prereqs",
  "get_enabled_tools",
  "get_git_author",
  "get_session_conflicts",
]);

/** Numeric channels — `null` silently disables the banners that compare them. */
const NUMBER_DEFAULTS: Record<string, number> = {
  get_session_commits_ahead: 0,
  get_session_commits_behind: 0,
};

/**
 * String-typed channels. The diffs matter most: the changes panel reads
 * `.length` off them, so `null` takes the whole session view down.
 */
const STRING_DEFAULTS: Record<string, string> = {
  get_repo_branch: "main",
  get_last_commit_hash: "a3f91c2",
  get_session_diff: "",
  get_session_full_diff: "",
  get_session_staged_diff: "",
  get_session_untracked_diff: "",
  get_session_status: "",
};

/**
 * The scenario's own answer, or a shared default; `undefined` when neither
 * names the channel, so each caller picks its own fallback.
 */
export function cannedReply(
  scenario: FixtureScenario,
  channel: string,
  args: Record<string, unknown>,
): unknown {
  if (channel in scenario.channels) {
    const value = scenario.channels[channel];

    return typeof value === "function"
      ? (value as (a: Record<string, unknown>) => unknown)(args)
      : value;
  }
  if (channel in DEFAULTS) {
    return DEFAULTS[channel];
  }
  if (channel in STRING_DEFAULTS) {
    return STRING_DEFAULTS[channel];
  }

  return NUMBER_DEFAULTS[channel];
}

/** Lists must stay arrays or the first `.map()` in a store throws. */
export function reply(
  scenario: FixtureScenario,
  channel: string,
  args: Record<string, unknown>,
): unknown {
  const canned = cannedReply(scenario, channel, args);
  if (canned !== undefined) {
    return canned;
  }

  // Three spellings are in use: `list_sessions`, `automations_list`, and
  // `llm_list_runners` — the last one is why this matches `list` anywhere in
  // the name rather than only as a prefix or suffix.
  if (
    ARRAY_CHANNELS.has(channel) ||
    /(^|_)(list|get_all|search)_|_list$/.test(channel)
  ) {
    return [];
  }

  // `null`, not `{}`: React renders null as nothing, whereas a bare object
  // thrown into JSX by a string-typed channel is a hard error.
  return null;
}
