import type { ProposalCta, ProposalSourceRef } from "../../types";
import type { FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE, NOW, REPO } from "./aurora";

const MINUTES = 60_000;
const HOURS = 60 * MINUTES;

const GUARDRAILS = {
  confidence_threshold: 0.7,
  max_concurrent_sessions: 2,
  max_cost_usd_per_run: 4,
  max_files_changed: 25,
  path_denylist: ["fastlane/**", "**/*.pbxproj"],
  require_clean_ci: true,
};

function automation(
  id: string,
  name: string,
  description: string,
  cron: string,
  autonomy: "auto_merge" | "draft" | "pr" | "propose",
  sources: string[],
  lastRunHoursAgo: number,
) {
  return {
    autonomy,
    created_at: NOW - 30 * 24 * HOURS,
    description,
    enabled: true,
    guardrails: GUARDRAILS,
    id,
    last_run_at: NOW - lastRunHoursAgo * HOURS,
    model: null,
    name,
    next_run_at: NOW + 3 * HOURS,
    playbook: "",
    scope: { repo_roots: [REPO] },
    source_ids: sources,
    template_id: null,
    trigger: {
      kind: "schedule",
      cron,
      timezone: "Europe/Amsterdam",
      catch_up: true,
    },
    updated_at: NOW - 2 * 24 * HOURS,
  };
}

const AUTOMATIONS = [
  automation(
    "aut_triage",
    "Morning triage",
    "Read overnight issues and crash reports, propose what's worth doing today.",
    "0 8 * * 1-5",
    "propose",
    ["github"],
    2,
  ),
  automation(
    "aut_reviews",
    "Review requests",
    "Summarise PRs waiting on me and draft the obvious review comments.",
    "0 */2 * * *",
    "propose",
    ["github_pull_requests"],
    1,
  ),
  automation(
    "aut_deps",
    "Dependency sweep",
    "Take the safe dependency bumps, run the test suite, open a draft PR.",
    "0 5 * * 1",
    "pr",
    [],
    20,
  ),
];

/** Mirrors the host's fallback: Start for work, the source link otherwise. */
function fixtureCta(
  action: string,
  sourceRef: ProposalSourceRef | null,
): ProposalCta | null {
  if (action === "start_session") {
    return { kind: "start_session", label: "Start", url: null };
  }
  if (sourceRef) {
    return {
      kind: "open_url",
      label: `Open ${sourceRef.external_id}`,
      url: sourceRef.url,
    };
  }

  return null;
}

function proposal(
  id: string,
  title: string,
  summary: string,
  rationale: string,
  confidence: number,
  action: "ignore" | "needs_info" | "review" | "start_session",
  externalId: string | null,
  minutesAgo: number,
) {
  const sourceRef = externalId
    ? {
        external_id: externalId,
        source_id: "github",
        url: `https://github.com/aurora/aurora/issues/${externalId.split("#")[1]}`,
      }
    : null;

  return {
    automation_id: "aut_triage",
    confidence,
    created_at: NOW - minutesAgo * MINUTES,
    cta: fixtureCta(action, sourceRef),
    dismissed_reason: null,
    id,
    rationale,
    recommended_action: action,
    repo_root: REPO,
    run_id: "run_8821",
    session_id: null,
    source_ref: sourceRef,
    status: "pending",
    summary,
    title,
  };
}

const PROPOSALS = [
  proposal(
    "prop_1",
    "Downloads stop working in airplane mode",
    "Three crash reports and one issue overnight all point at `EpisodeLoader.load` going to the network even when the file is already on disk. The fix is a cache read in front of the fetch.",
    "Same stack trace in 41 sessions since Tuesday's release, and a reproducible issue with steps.",
    0.86,
    "start_session",
    "aurora#412",
    18,
  ),
  proposal(
    "prop_2",
    "Search is O(n) over the whole library",
    "Search filters the full episode list on every keystroke. Above ~4k episodes the field visibly stutters. A trigram index would make it constant-time.",
    "Two complaints this week, and the profiler run attached to #398 backs it up.",
    0.74,
    "start_session",
    "aurora#398",
    42,
  ),
  proposal(
    "prop_3",
    "Bump swift-collections to 1.2",
    "Patch release, no API changes, CI is green on the branch. Low risk but it touches the lockfile, so it wants a human on the merge.",
    "Dependabot opened it four days ago and nothing has looked at it.",
    0.55,
    "review",
    "aurora#405",
    140,
  ),
];

function run(
  id: string,
  automationId: string,
  status: string,
  minutesAgo: number,
  report: string,
  reportRead = true,
) {
  return {
    automation_id: automationId,
    cost_usd: 0.42,
    error: null,
    finished_at: NOW - minutesAgo * MINUTES,
    host_agent_id: null,
    host_session_id: null,
    id,
    report_blocks: null,
    report_markdown: report,
    report_read: reportRead,
    started_at: NOW - (minutesAgo + 3) * MINUTES,
    status,
  };
}

const RUNS = [
  run(
    "run_8821",
    "aut_triage",
    "succeeded",
    18,
    "Read 14 new issues and 3 crash groups. Three are worth acting on; the rest are duplicates of #377.",
    false,
  ),
  run(
    "run_8820",
    "aut_reviews",
    "succeeded",
    63,
    "Two PRs are waiting on you; neither has conflicts.",
  ),
];

/**
 * Work Argus started on its own, waiting to be decided on. The tour goes
 * inbox → the automations behind it → the run that produced them.
 */
export const automations: FixtureScenario = {
  id: "automations",
  route: "/inbox",
  storage: BASE_STORAGE,
  events: AGENTS.map((a) => ({ channel: "agent:started", payload: a })),
  posterBeat: 0,
  beats: [
    { holdSeconds: 5 },
    { route: "/automations", holdSeconds: 5 },
    { route: "/automations/aut_triage", holdSeconds: 4.5 },
    { route: "/inbox", holdSeconds: 3.5 },
  ],
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
    proposals_list: PROPOSALS,
    automations_list: AUTOMATIONS,
    automation_runs_list: RUNS,
    automation_gate_log_list: [],
    list_signal_sources: [
      { id: "github", label: "GitHub", kind: "native", configured: true },
      {
        id: "github_pull_requests",
        label: "GitHub pull requests",
        kind: "native",
        configured: true,
      },
    ],
  },
};
