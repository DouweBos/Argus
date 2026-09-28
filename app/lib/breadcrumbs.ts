import type { AppView } from "./router";
import type { Automation, AutomationRun, Session } from "./types";
import type { Crumb } from "@argus/peacock";
import { formatTimestamp } from "./automations";

const VIEW_TITLES: Record<string, string> = {
  agents: "Agents",
  automations: "Automations",
  devices: "Devices",
  home: "Home",
  inbox: "Inbox",
  notifications: "Notifications",
  "pull-request-detail": "Pull requests",
  "pull-requests": "Pull requests",
  runtimes: "Runtimes",
};

/** Navigation the trail hands back to the caller, so this file stays pure. */
export interface BreadcrumbNav {
  openAutomation: (automationId: string) => void;
  openAutomations: () => void;
  openQuickRuns: () => void;
  openRun: (run: AutomationRun) => void;
}

export interface BreadcrumbInput {
  automationId: string | null;
  automationQuick: boolean;
  automationRunId: string | null;
  automations: Automation[];
  nav: BreadcrumbNav;
  runs: AutomationRun[];
  sessionId: string | null;
  sessions: Session[];
  view: AppView;
}

/**
 * The trail to the screen in view, so a nested screen never has to grow its own
 * back button. Automations nest; so does the session an automation run spawns
 * its agent into, which belongs under its run rather than beside your own work.
 * A report is a document on a run, not a step of its own.
 */
export function breadcrumbTrail(input: BreadcrumbInput): Crumb[] {
  const crumbs = buildTrail(input);
  // Where you already are is not somewhere to navigate to.
  const last = crumbs[crumbs.length - 1];
  if (last?.onClick) {
    crumbs[crumbs.length - 1] = { id: last.id, label: last.label };
  }

  return crumbs;
}

function buildTrail(input: BreadcrumbInput): Crumb[] {
  const { view, automationId, automationQuick, automationRunId, nav } = input;

  if (view === "automations") {
    const crumbs = automationTrail(
      automationId,
      automationQuick,
      findAutomation(input, automationId),
      nav,
    );
    const run = input.runs.find((r) => r.id === automationRunId) ?? null;
    if (automationRunId) {
      crumbs.push(
        run
          ? { id: run.id, label: formatTimestamp(run.started_at) }
          : { id: automationRunId, label: "Run" },
      );
    }

    return crumbs;
  }

  const session = input.sessionId
    ? (input.sessions.find((s) => s.id === input.sessionId) ?? null)
    : null;
  const hostRun =
    session?.kind === "automation_host"
      ? (input.runs.find((r) => r.host_session_id === session.id) ?? null)
      : null;

  if (session?.kind === "scratch_pad") {
    return [
      { id: "app", label: "Argus" },
      { id: "scratch-pads", label: "Scratch pads" },
      { id: session.id, label: session.display_name ?? "Scratch pad" },
    ];
  }

  if (session && hostRun) {
    const crumbs = automationTrail(
      hostRun.scratch ? null : hostRun.automation_id,
      Boolean(hostRun.scratch),
      findAutomation(input, hostRun.automation_id),
      nav,
    );
    crumbs.push({
      id: hostRun.id,
      label: formatTimestamp(hostRun.started_at),
      onClick: () => nav.openRun(hostRun),
    });
    crumbs.push({ id: session.id, label: session.display_name ?? "Agent" });

    return crumbs;
  }

  return [
    { id: "app", label: "Argus" },
    { id: "view", label: VIEW_TITLES[view] ?? "Home" },
  ];
}

function findAutomation(
  input: BreadcrumbInput,
  id: string | null,
): Automation | null {
  return id ? (input.automations.find((a) => a.id === id) ?? null) : null;
}

/** `Argus · Automations · <the automation, or Quick runs>`. */
function automationTrail(
  automationId: string | null,
  quick: boolean,
  automation: Automation | null,
  nav: BreadcrumbNav,
): Crumb[] {
  const crumbs: Crumb[] = [
    { id: "app", label: "Argus" },
    { id: "view", label: "Automations", onClick: nav.openAutomations },
  ];

  if (quick) {
    crumbs.push({
      id: "quick",
      label: "Quick runs",
      onClick: nav.openQuickRuns,
    });
  } else if (automationId) {
    crumbs.push({
      id: automationId,
      label: automation?.name ?? "Automation",
      onClick: () => nav.openAutomation(automationId),
    });
  }

  return crumbs;
}
