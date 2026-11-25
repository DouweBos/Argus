/**
 * A finished duty run, handed to its teammate's conversation: the teammate
 * tells you what it did in its own words, and your reply reaches an agent
 * that has the report in context.
 */

import type { Automation, AutomationRun } from "../automation/models";
import type { ReportBlock } from "@argus/remote-protocol";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { getAutomation } from "../automation/manager";
import { reportPreview } from "../automation/reportPreview";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { findTeammate } from "./registry";
import { openThread, titleThread } from "./threads";

/** A run that finished longer ago is old news, e.g. one marked read after a restart. */
const FRESH_MS = 10 * 60_000;
/** The conversation is mid-turn: try again this often, this many times. */
const RETRY_MS = 30_000;
const MAX_ATTEMPTS = 20;
const REPORT_MAX_CHARS = 12_000;

const handed = new Set<string>();
let unsubscribe: (() => void) | null = null;

export function startDutyReports(): void {
  unsubscribe ??= addHostEventSink((channel, args) => {
    if (channel === "automation_run:changed") {
      runChanged(args[0] as AutomationRun | null).catch(() => undefined);
    }
  });
}

export function stopDutyReports(): void {
  unsubscribe?.();
  unsubscribe = null;
  handed.clear();
}

async function runChanged(run: AutomationRun | null): Promise<void> {
  if (
    !run?.finished_at ||
    handed.has(run.id) ||
    Date.now() - run.finished_at > FRESH_MS
  ) {
    return;
  }
  const automation = getAutomation(run.automation_id);
  const teammate = automation?.teammate_id
    ? findTeammate(automation.teammate_id)
    : null;
  const prompt = automation ? dutyReportPrompt(automation, run) : null;
  if (
    !automation ||
    !teammate?.enabled ||
    !prompt ||
    run.status === "skipped"
  ) {
    return;
  }
  handed.add(run.id);
  await deliver(teammate.id, automation, run, prompt, 1);
}

async function deliver(
  teammateId: string,
  automation: Automation,
  run: AutomationRun,
  prompt: string,
  attempt: number,
): Promise<void> {
  const status = run.status === "failed" ? "failed" : "succeeded";
  try {
    const opened = await openThread(teammateId);
    // Lazy: the agent service reaches back into teammates (see threads.ts).
    const { isAgentWorking, submitAgentMessage } =
      await import("../agent/conversation/actions");
    const agent = appState.agents.get(opened.agent_id);
    if (agent && isAgentWorking(agent)) {
      if (attempt >= MAX_ATTEMPTS) {
        telemetryCapture("teammate_duty_reported", {
          status,
          delivered: false,
        });

        return;
      }
      setTimeout(() => {
        deliver(teammateId, automation, run, prompt, attempt + 1).catch(
          () => undefined,
        );
      }, RETRY_MS);

      return;
    }
    // Named before the prompt arrives, which would otherwise title a new thread.
    titleThread(
      opened.thread.id,
      reportPreview(run) ??
        `${automation.name} ${status === "failed" ? "failed" : "finished"}`,
    );
    await submitAgentMessage(opened.agent_id, {
      text: prompt,
      displayText: `${automation.name} ${status === "failed" ? "failed" : "finished"}`,
      dutyRun: {
        automationId: automation.id,
        automationName: automation.name,
        runId: run.id,
        status,
      },
    });
    telemetryCapture("teammate_duty_reported", { status, delivered: true });
  } catch (e) {
    warn(
      `[teammate] couldn't hand run ${run.id} to ${teammateId}: ${String(e)}`,
    );
    telemetryCapture("teammate_duty_reported", { status, delivered: false });
  }
}

/** What the teammate is told; null when the run has nothing to say. */
export function dutyReportPrompt(
  automation: Pick<Automation, "name">,
  run: Pick<
    AutomationRun,
    "error" | "report_blocks" | "report_markdown" | "status"
  >,
): string | null {
  if (run.status === "failed") {
    return [
      `[Argus] Your duty "${automation.name}" just failed: ${run.error ?? "no reason given"}`,
      "",
      "Tell the user in a sentence or two what went wrong and whether they need to do anything. Don't use tools unless they ask.",
    ].join("\n");
  }
  if (run.status !== "succeeded") {
    return null;
  }
  const report = reportText(run);
  if (!report) {
    return null;
  }

  return [
    `[Argus] Your duty "${automation.name}" just finished. Its report is below; the user can open the full report from this conversation.`,
    "",
    "Tell the user what happened, in your own voice, like a message to a colleague: the outcome first, then what matters — the numbers, the problems you found, what was missing, what you'd improve or do next. A few sentences or short bullets. Don't paste the report back and don't use tools unless they ask for more.",
    "",
    "<report>",
    report,
    "</report>",
  ].join("\n");
}

/** The report as plain text: its blocks when it has them, else its markdown. */
export function reportText(
  run: Pick<AutomationRun, "report_blocks" | "report_markdown">,
): string {
  const blocks = run.report_blocks ?? [];
  const text =
    blocks.length > 0
      ? blocks.map(blockText).filter(Boolean).join("\n\n")
      : (run.report_markdown ?? "");
  const trimmed = text.trim();

  return trimmed.length > REPORT_MAX_CHARS
    ? `${trimmed.slice(0, REPORT_MAX_CHARS)}\n[…cut]`
    : trimmed;
}

function blockText(block: ReportBlock): string {
  switch (block.type) {
    case "heading":
      return `## ${block.text}`;
    case "markdown":
      return block.text;
    case "stats":
      return block.items.map((i) => `${i.label}: ${i.value}`).join("\n");
    case "table":
      return [block.columns, ...block.rows]
        .map((row) => row.join(" | "))
        .join("\n");
    case "list":
      return block.items.map((i) => `- ${i.text}`).join("\n");
    case "proposals":
      return `(${block.ids.length} proposal(s) in the report)`;
    case "sessions":
      return `(${block.ids.length} session(s) in the report)`;
    default:
      return "";
  }
}
