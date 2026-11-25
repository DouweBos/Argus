import type { SlackConfig } from "./store";
import type { Automation, AutomationRun } from "../automation/models";
import { describe, expect, it, vi } from "vitest";
import { slackTrigger, slackTriggerMatches } from "../automation/slackTrigger";
import { fireSlackTriggers, ReportPoster, reportMessage } from "./automations";

vi.mock("@argus/host/logger", () => ({ warn: vi.fn() }));

const channel = { id: "CDEPLOY", name: "deploys" };
const config: SlackConfig = {
  defaultProject: null,
  mappings: [],
  allowedUsers: [],
  owner: { user_id: "UOWNER", name: null },
  claimCode: null,
};

function automation(patch: Partial<Automation>): Automation {
  return {
    id: "auto1",
    name: "Triage deploys",
    description: "",
    enabled: true,
    trigger: slackTrigger({ channel, match: "prefix", text: "deploy failed" }),
    scope: { repo_roots: [] },
    source_ids: [],
    playbook: "x",
    extra_instructions: "",
    autonomy: null,
    guardrails: {} as Automation["guardrails"],
    model: null,
    runner: null,
    claude_account_id: null,
    template_id: null,
    teammate_id: null,
    seeded_playbook_hash: null,
    precheck_command: "",
    precheck_timeout_seconds: 60,
    continue_conversation: false,
    created_at: 0,
    updated_at: 0,
    last_run_at: null,
    next_run_at: null,
    ...patch,
  };
}

describe("slack trigger", () => {
  it("matches a prefix, a whole keyword or any message in its channel", () => {
    const prefix = slackTrigger({
      channel,
      match: "prefix",
      text: "Deploy failed",
    });
    expect(
      slackTriggerMatches(prefix, {
        channel: "CDEPLOY",
        text: "deploy FAILED on web",
      }),
    ).toBe(true);
    expect(
      slackTriggerMatches(prefix, {
        channel: "CDEPLOY",
        text: "the deploy failed",
      }),
    ).toBe(false);
    expect(
      slackTriggerMatches(prefix, { channel: "COTHER", text: "deploy failed" }),
    ).toBe(false);

    const keyword = slackTrigger({
      channel,
      match: "keyword",
      text: "rollback",
    });
    expect(
      slackTriggerMatches(keyword, {
        channel: "CDEPLOY",
        text: "please rollback now",
      }),
    ).toBe(true);
    expect(
      slackTriggerMatches(keyword, {
        channel: "CDEPLOY",
        text: "rollbacks are fine",
      }),
    ).toBe(false);

    const any = slackTrigger({ channel, match: "any", text: "ignored" });
    expect(any.text).toBe("");
    expect(slackTriggerMatches(any, { channel: "CDEPLOY", text: "hi" })).toBe(
      true,
    );
  });

  it("refuses a keyword trigger with no keyword", () => {
    expect(() =>
      slackTrigger({ channel, match: "keyword", text: " " }),
    ).toThrow();
  });
});

describe("fireSlackTriggers", () => {
  const message = {
    teamId: "T1",
    channel: "CDEPLOY",
    user: "UOWNER",
    text: "deploy failed: web",
    ts: "1.1",
    threadTs: null,
  };

  it("fires enabled matching automations with the message as the event", () => {
    const fire = vi.fn();
    const fired = fireSlackTriggers({
      message,
      config,
      automations: [
        automation({}),
        automation({ id: "off", enabled: false }),
        automation({ id: "manual", trigger: { kind: "manual" } }),
      ],
      fire,
      now: 5,
    });

    expect(fired).toEqual(["auto1"]);
    expect(fire).toHaveBeenCalledWith("auto1", {
      origin: "slack",
      kind: "slack_message",
      summary: "slack #deploys",
      items: [],
      payload: {
        channel: "deploys",
        text: "deploy failed: web",
        ts: "1.1",
        thread_ts: null,
      },
      received_at: 5,
    });
  });

  it("leaves out a trigger whose channel is in another workspace", () => {
    const fire = vi.fn();
    const base = automation({});
    const elsewhere = {
      ...base,
      trigger: {
        ...base.trigger,
        channel: { id: "CDEPLOY", name: "deploys", team_id: "T2" },
      },
    } as typeof base;
    fireSlackTriggers({
      message,
      config,
      automations: [elsewhere],
      fire,
      now: 0,
    });

    expect(fire).not.toHaveBeenCalled();
  });

  it("ignores members who may not drive agents", () => {
    const fire = vi.fn();
    fireSlackTriggers({
      message: { ...message, user: "USTRANGER" },
      config,
      automations: [automation({})],
      fire,
      now: 0,
    });

    expect(fire).not.toHaveBeenCalled();
  });
});

describe("reports", () => {
  const run = (patch: Partial<AutomationRun>): AutomationRun =>
    ({
      id: "run1",
      automation_id: "auto1",
      status: "succeeded",
      finished_at: 1000,
      report_markdown: "## Findings\n**2** deploys failed",
      error: null,
      ...patch,
    }) as AutomationRun;

  it("formats a report as mrkdwn with a link to the run", () => {
    expect(reportMessage(automation({}), run({}))).toBe(
      "*Triage deploys*\n*Findings*\n*2* deploys failed",
    );
    expect(
      reportMessage(
        automation({}),
        run({ status: "failed", error: "out of budget" }),
      ),
    ).toContain(
      "failed: out of budget\n<argus://automations/auto1/runs/run1|Open the run in Argus>",
    );
    expect(
      reportMessage(automation({}), run({ status: "running" })),
    ).toBeNull();
  });

  it("posts a fresh finished run once, to the automation's channel", async () => {
    const postMessage = vi.fn(async () => ({ channel: "C", ts: "1" }));
    const onPosted = vi.fn();
    const poster = new ReportPoster({
      api: () => ({ postMessage }),
      automation: () =>
        automation({
          report_slack_channel: { id: "CREPORTS", name: "reports" },
        }),
      onPosted,
      now: () => 2000,
    });
    await poster.runChanged(run({}));
    await poster.runChanged(run({}));
    await poster.runChanged(
      run({ id: "old", finished_at: 2000 - 11 * 60_000 }),
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "CREPORTS" }),
    );
    expect(onPosted).toHaveBeenCalledWith(true);
  });

  it("posts nothing for an automation without a report channel", async () => {
    const postMessage = vi.fn();
    const poster = new ReportPoster({
      api: () => ({ postMessage }),
      automation: () => automation({}),
      onPosted: vi.fn(),
      now: () => 2000,
    });
    await poster.runChanged(run({}));

    expect(postMessage).not.toHaveBeenCalled();
  });
});
