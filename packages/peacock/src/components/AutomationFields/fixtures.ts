// Story fixtures for the automation screens, in the gateway's shapes.
import type { ClaudeAccountLike } from "@argus/client-core";
import type {
  AutomationCalibration,
  RemoteAutomation,
  RemoteAutomationDetail,
  RemoteAutomationMemory,
  RemoteAutomationRun,
  RemoteProposal,
  RemoteRunner,
  RemoteSignalSource,
} from "@argus/remote-protocol";

const NOW = Date.now();
const HOUR = 3_600_000;

export const FIXTURE_DETAIL: RemoteAutomationDetail = {
  id: "a1",
  name: "Morning triage",
  description: "Reads new issues and failing CI, proposes what to pick up.",
  enabled: true,
  trigger_kind: "schedule",
  cron: "0 9 * * 1-5",
  timezone: "Europe/Amsterdam",
  catch_up: true,
  repo_roots: ["/src/argus"],
  source_ids: ["github_issues"],
  playbook:
    "# Morning triage\n\nRead the new issues and propose what to start.",
  extra_instructions: "",
  autonomy: null,
  model: null,
  runner: null,
  claude_account_id: null,
  guardrails: {
    confidence_threshold: 0.8,
    max_concurrent_sessions: 2,
    max_files_changed: 25,
    max_cost_usd_per_run: 0,
    max_run_minutes: 20,
    path_denylist: [],
    require_clean_ci: true,
    retry_other_accounts: true,
  },
};

export const FIXTURE_PROJECTS = [
  { id: "/src/argus", label: "Argus" },
  { id: "/src/app", label: "Mobile app" },
];

export const FIXTURE_SOURCES: RemoteSignalSource[] = [
  {
    id: "github_issues",
    label: "GitHub issues",
    mode: "native",
    available: true,
  },
  { id: "linear", label: "Linear", mode: "agent", available: false },
];

export const FIXTURE_RUNNERS: RemoteRunner[] = [
  {
    id: "claude-code",
    display_name: "Claude Code",
    is_custom: false,
    default_model: null,
    models: [],
  },
  {
    id: "local",
    display_name: "Local model",
    is_custom: true,
    default_model: "qwen",
    models: [
      { value: "qwen", display_name: "Qwen", description: "Fast and local" },
    ],
  },
];

export const FIXTURE_ACCOUNTS: ClaudeAccountLike[] = [
  {
    id: "default",
    label: "Personal",
    email: "me@example.com",
    subscription_type: "max",
    account_type: "claudeai",
  },
  {
    id: "work",
    email: "me@corp.example",
    org_name: "Corp",
    subscription_type: "team",
    account_type: "claudeai",
  },
];

export const FIXTURE_AUTOMATIONS: RemoteAutomation[] = [
  {
    id: "a1",
    name: "Morning triage",
    description: "Reads new issues and failing CI.",
    enabled: true,
    trigger_kind: "schedule",
    cron: "0 9 * * 1-5",
    timezone: "Europe/Amsterdam",
    autonomy: null,
    projects: ["Argus"],
    last_run_at: NOW - 3 * HOUR,
    next_run_at: NOW + 18 * HOUR,
    running: false,
  },
  {
    id: "a2",
    name: "Stale branches",
    description: "",
    enabled: false,
    trigger_kind: "manual",
    cron: null,
    timezone: null,
    autonomy: "propose",
    projects: [],
    last_run_at: null,
    next_run_at: null,
    running: false,
  },
];

export function fixtureRun(
  over: Partial<RemoteAutomationRun> = {},
): RemoteAutomationRun {
  return {
    id: "r1",
    automation_id: "a1",
    automation_name: "Morning triage",
    is_quick: false,
    status: "succeeded",
    trigger_reason: "schedule 09:00",
    started_at: NOW - 2 * HOUR,
    finished_at: NOW - 2 * HOUR + 154_000,
    cost_usd: 0.42,
    error: null,
    unread_report: true,
    report_read: false,
    report_preview: "Two issues worth starting today",
    host_session_id: "s1",
    host_agent_id: "ag1",
    ...over,
  };
}

export function fixtureProposal(
  over: Partial<RemoteProposal> = {},
): RemoteProposal {
  return {
    id: "p1",
    automation_id: "a1",
    automation_name: "Morning triage",
    run_id: "r1",
    title: "Fix the crash when opening a deleted worktree",
    summary: "Opening a session whose worktree was removed on disk throws.",
    rationale: "Three reports this week, and the fix is small.",
    confidence: 0.86,
    cta: {
      kind: "start_session",
      label: "Start",
      url: null,
      branch: null,
      force: false,
      session_id: null,
    },
    status: "pending",
    project: "Argus",
    source_label: "argus#412",
    source_url: "https://example.test/412",
    session_id: null,
    agent_id: null,
    start_stage: null,
    start_error: null,
    created_at: NOW - HOUR,
    ...over,
  };
}

export const FIXTURE_MEMORIES: RemoteAutomationMemory[] = [
  {
    name: "session-merge-flow",
    description: "How merges land on main in this repo.",
    type: "project",
    body: "Squash merges only; the PR title becomes the commit subject.",
    updated_at: NOW - 24 * HOUR,
  },
  {
    name: "skip-design-issues",
    description: "Douwe dismisses anything labelled needs-design.",
    type: "feedback",
    body: "Don't propose issues labelled `needs-design`.",
    updated_at: NOW - 3 * 24 * HOUR,
  },
];

export const FIXTURE_CALIBRATION: AutomationCalibration = {
  automation_id: "a1",
  sample: 12,
  accepted: 5,
  auto_started: 1,
  resolved: 1,
  dismissed: 5,
  pending: 2,
  superseded: 0,
  withdrawn: 0,
  merged: 4,
  abandoned: 1,
  reverted: 0,
  acceptance_rate: 0.58,
  dismissals: [
    { title: "Rename the settings store", reason: "Not worth the churn." },
  ],
  accepted_notes: [],
};
