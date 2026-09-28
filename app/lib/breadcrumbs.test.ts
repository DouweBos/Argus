import type { Automation, AutomationRun, Session } from "./types";
import { describe, expect, it, vi } from "vitest";
import { breadcrumbTrail, type BreadcrumbInput } from "./breadcrumbs";

const automation = { id: "a1", name: "Standup digest" } as Automation;

const run = {
  automation_id: "a1",
  host_session_id: "s1",
  id: "r1",
  scratch: null,
  started_at: 1_700_000_000_000,
} as AutomationRun;

const hostSession = {
  display_name: "Generate Daily Standup Digest",
  id: "s1",
  kind: "automation_host",
} as Session;

const nav = {
  openAutomation: vi.fn(),
  openAutomations: vi.fn(),
  openQuickRuns: vi.fn(),
  openRun: vi.fn(),
};

const trail = (over: Partial<BreadcrumbInput>) =>
  breadcrumbTrail({
    automationId: null,
    automationQuick: false,
    automationRunId: null,
    automations: [automation],
    nav,
    runs: [run],
    sessionId: null,
    sessions: [hostSession],
    view: "home",
    ...over,
  }).map((c) => c.label);

describe("breadcrumbTrail", () => {
  it("names the view for a flat screen", () => {
    expect(trail({ view: "inbox" })).toEqual(["Argus", "Inbox"]);
  });

  it("puts an automation under the list", () => {
    expect(trail({ view: "automations", automationId: "a1" })).toEqual([
      "Argus",
      "Automations",
      "Standup digest",
    ]);
  });

  it("puts a run under its automation, and stops there — a report is the run", () => {
    expect(
      trail({ view: "automations", automationId: "a1", automationRunId: "r1" }),
    ).toHaveLength(4);
  });

  it("files ad-hoc runs under Quick runs", () => {
    expect(trail({ view: "automations", automationQuick: true })).toEqual([
      "Argus",
      "Automations",
      "Quick runs",
    ]);
  });

  it("puts an automation's host session under its run, not beside your worktrees", () => {
    expect(trail({ view: "session", sessionId: "s1" })).toEqual([
      "Argus",
      "Automations",
      "Standup digest",
      expect.any(String),
      "Generate Daily Standup Digest",
    ]);
  });

  it("puts a scratch pad under scratch pads", () => {
    expect(
      trail({
        view: "session",
        sessionId: "p1",
        sessions: [
          { id: "p1", kind: "scratch_pad", display_name: "Notes" } as Session,
        ],
      }),
    ).toEqual(["Argus", "Scratch pads", "Notes"]);
  });

  it("leaves a worktree session to the branch line", () => {
    expect(
      trail({
        view: "session",
        sessionId: "s2",
        sessions: [{ id: "s2", kind: "worktree" } as Session],
      }),
    ).toEqual(["Argus", "Home"]);
  });

  it("only the last crumb is where you are", () => {
    const crumbs = breadcrumbTrail({
      automationId: "a1",
      automationQuick: false,
      automationRunId: null,
      automations: [automation],
      nav,
      runs: [run],
      sessionId: null,
      sessions: [],
      view: "automations",
    });
    expect(crumbs.at(-1)?.onClick).toBeUndefined();
    expect(crumbs[1]?.onClick).toBeTypeOf("function");
  });
});
