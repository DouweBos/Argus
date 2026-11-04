/**
 * The typed `automations.*` answers, derived from a scenario's renderer
 * replies (`automations_list`, `automation_runs_list`) the way the host's
 * `automationsRemote` derives them from its store.
 */

import type {
  RemoteAutomation,
  RemoteAutomationDetail,
  RemoteAutomationRun,
} from "@argus/remote-protocol";
import { basename } from "node:path";

type Reply = (channel: string) => unknown;

interface Automation {
  autonomy: RemoteAutomation["autonomy"];
  claude_account_id: string | null;
  description: string;
  enabled: boolean;
  extra_instructions: string;
  guardrails: RemoteAutomationDetail["guardrails"];
  id: string;
  last_run_at: number | null;
  model: string | null;
  name: string;
  next_run_at: number | null;
  playbook: string;
  runner: string | null;
  scope: { repo_roots: string[] };
  source_ids: string[];
  trigger: {
    catch_up?: boolean;
    cron?: string;
    kind: "manual" | "schedule";
    timezone?: string;
  };
}

interface Run {
  automation_id: string;
  cost_usd: number | null;
  error: string | null;
  finished_at: number | null;
  host_agent_id: string | null;
  host_session_id: string | null;
  id: string;
  report_markdown: string | null;
  report_read: boolean;
  started_at: number;
  status: RemoteAutomationRun["status"];
}

function automations(reply: Reply): Automation[] {
  return (reply("automations_list") ?? []) as Automation[];
}

function runs(reply: Reply): Run[] {
  return (reply("automation_runs_list") ?? []) as Run[];
}

function summary(a: Automation, running: boolean): RemoteAutomation {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    trigger_kind: a.trigger.kind,
    cron: a.trigger.cron ?? null,
    timezone: a.trigger.timezone ?? null,
    autonomy: a.autonomy,
    projects: a.scope.repo_roots.map((root) => basename(root)),
    last_run_at: a.last_run_at,
    next_run_at: a.next_run_at,
    running,
  };
}

function detail(a: Automation): RemoteAutomationDetail {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    trigger_kind: a.trigger.kind,
    cron: a.trigger.cron ?? null,
    timezone: a.trigger.timezone ?? null,
    catch_up: a.trigger.catch_up ?? false,
    repo_roots: a.scope.repo_roots,
    source_ids: a.source_ids,
    playbook: a.playbook,
    extra_instructions: a.extra_instructions,
    autonomy: a.autonomy,
    model: a.model,
    runner: a.runner,
    claude_account_id: a.claude_account_id,
    guardrails: a.guardrails,
  };
}

function run(r: Run, list: Automation[]): RemoteAutomationRun {
  const report = r.report_markdown?.trim() ?? "";

  return {
    id: r.id,
    automation_id: r.automation_id,
    automation_name:
      list.find((a) => a.id === r.automation_id)?.name ?? "Quick run",
    is_quick: false,
    status: r.status,
    trigger_reason: "schedule",
    started_at: r.started_at,
    finished_at: r.finished_at,
    cost_usd: r.cost_usd,
    error: r.error,
    unread_report: report.length > 0 && !r.report_read,
    report_read: r.report_read,
    report_preview: report ? report.split("\n")[0].slice(0, 140) : null,
    host_session_id: r.host_session_id,
    host_agent_id: r.host_agent_id,
  };
}

/** The typed reply, or `undefined` for a method this doesn't cover. */
export function automationReply(
  method: string,
  params: Record<string, unknown>,
  reply: Reply,
): unknown {
  const list = automations(reply);
  switch (method) {
    case "automations.list":
      return {
        automations: list.map((a) =>
          summary(
            a,
            runs(reply).some(
              (r) => r.automation_id === a.id && r.status === "running",
            ),
          ),
        ),
      };
    case "automations.get": {
      const found = list.find((a) => a.id === params.automation_id);

      return found ? { automation: detail(found) } : undefined;
    }
    case "automations.runs":
      return {
        runs: runs(reply)
          .filter(
            (r) =>
              !params.automation_id || r.automation_id === params.automation_id,
          )
          .map((r) => run(r, list)),
      };
    case "automations.run": {
      const found = runs(reply).find((r) => r.id === params.run_id);

      return found
        ? {
            run: run(found, list),
            report_blocks: null,
            report_markdown: found.report_markdown,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}
