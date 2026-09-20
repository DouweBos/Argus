/**
 * Drafting an automation from a sentence.
 *
 * The two hard parts of authoring an automation are the playbook (a blank
 * page) and the cron (a syntax people get wrong), so this asks Claude for both
 * and then refuses to trust the answer: the cron is run through the same
 * evaluator the scheduler uses, the scope is intersected with the registered
 * projects, and the autonomy the description asked for is thrown away.
 *
 * What comes back is a *draft*, never a saved automation. The user reviews it
 * and presses save — a model must not be able to create a live, scheduled,
 * autonomous thing by itself.
 */

import type {
  AutomationTrigger,
  AutonomyLevel,
  CreateAutomationInput,
} from "./models";
import { tmpdir } from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { runClaudePrint } from "../llm/oneShot";
import { collectAllProjects } from "../mcp/projects";
import { describeSignalSources } from "../signals/registry";
import { computeNextRun, isValidCron } from "./cron";
import { autonomyRank, isAutonomyLevel } from "./guardrails";
import { BUILT_IN_TEMPLATES } from "./templates";

const MAX_DESCRIPTION_INPUT_CHARS = 2000;
const MAX_NAME_CHARS = 60;
const MAX_BLURB_CHARS = 200;
const MAX_PLAYBOOK_CHARS = 20_000;
const DRAFT_TIMEOUT_MS = 180_000;

/**
 * The highest rung a generated automation may ask for. Anything above it is
 * dropped to "inherit the app default" — the ladder is the user's choice, and
 * a description is an untrusted way to climb it.
 */
const MAX_GENERATED_AUTONOMY: AutonomyLevel = "propose";

/** A draft automation plus everything Argus had to correct about it. */
export interface AutomationDraft {
  /** Ready to hand to `createAutomation` — always disabled, never autonomous. */
  input: CreateAutomationInput;
  /** What was repaired or dropped, shown to the user above the draft. */
  notes: string[];
}

/** What the sanitiser checks the model's answer against. */
export interface DraftContext {
  /** Absolute roots of the registered projects a scope may name. */
  repoRoots: string[];
  /** Ids of the signal sources that exist. */
  sourceIds: string[];
  /** Fallback zone when the model omits one or names one that does not exist. */
  timezone: string;
}

export interface DraftAutomationOptions {
  description: string;
  /** Overrides the host's zone; the UI passes the viewer's. */
  timezone?: string;
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });

    return true;
  } catch {
    return false;
  }
}

/** Trim, collapse whitespace, cap. Returns "" for anything that is not a string. */
function text(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const collapsed = value.replace(/\s+/g, " ").trim();

  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) : collapsed;
}

const CRON_MACROS: Record<string, string> = {
  "@annually": "0 0 1 1 *",
  "@daily": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@midnight": "0 0 * * *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@yearly": "0 0 1 1 *",
};

/**
 * Coax a model-written schedule into the 5-field grammar `cron.ts` speaks:
 * macros expand, Quartz `?` becomes `*`, and the seconds/year fields other
 * dialects add are dropped. Returns null when nothing salvageable is left.
 */
export function repairCron(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const macro = CRON_MACROS[trimmed];
  if (macro) {
    return macro;
  }

  let fields = trimmed.split(/\s+/).map((f) => f.replace(/\?/g, "*"));
  // Quartz writes `sec min hour dom mon dow [year]`; drop the extremes.
  if (fields.length === 7) {
    fields = fields.slice(1, 6);
  } else if (fields.length === 6) {
    fields = /^\d{4}(?:[,/-]|$)/.test(fields[5])
      ? fields.slice(0, 5)
      : fields.slice(1);
  }
  if (fields.length !== 5) {
    return null;
  }
  const expression = fields.join(" ");

  return isValidCron(expression) ? expression : null;
}

/** True when the expression parses *and* fires again within four years. */
function cronFires(expression: string, timezone: string): boolean {
  try {
    return computeNextRun(expression, timezone, Date.now()) !== null;
  } catch {
    return false;
  }
}

/**
 * The rung a generated draft gets. Never above `propose`: a level the
 * description talked the model into is exactly the level not to honour.
 */
export function clampGeneratedAutonomy(raw: unknown): {
  autonomy: AutonomyLevel | null;
  note: string | null;
} {
  if (!isAutonomyLevel(raw)) {
    return { autonomy: null, note: null };
  }
  if (autonomyRank(raw) > autonomyRank(MAX_GENERATED_AUTONOMY)) {
    return {
      autonomy: null,
      note: `Ignored the suggested autonomy level "${raw}" — a generated automation inherits the app default. Raise it yourself once you trust it.`,
    };
  }

  return { autonomy: null, note: null };
}

function normalizeRoot(value: string): string {
  const resolved = path.resolve(value.trim());

  return resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

/**
 * Everything between the model's JSON and a `CreateAutomationInput` we would
 * be willing to save. Pure, so the rules are testable without an LLM.
 */
export function sanitizeDraft(
  raw: unknown,
  ctx: DraftContext,
): AutomationDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const name = text(obj.name, MAX_NAME_CHARS) || "New automation";
  const description = text(obj.description, MAX_BLURB_CHARS);
  const playbook =
    typeof obj.playbook === "string"
      ? obj.playbook.trim().slice(0, MAX_PLAYBOOK_CHARS)
      : "";
  if (!playbook) {
    return null;
  }

  const notes: string[] = [];

  // Trigger. A schedule that does not parse, or parses but never fires, is
  // downgraded to manual rather than handed over broken.
  const triggerObj =
    obj.trigger && typeof obj.trigger === "object"
      ? (obj.trigger as Record<string, unknown>)
      : {};
  const wantsSchedule = triggerObj.kind !== "manual";
  let trigger: AutomationTrigger = { kind: "manual" };
  if (wantsSchedule) {
    let timezone = text(triggerObj.timezone, 64);
    if (timezone && !isValidTimezone(timezone)) {
      notes.push(
        `"${timezone}" is not an IANA timezone — using ${ctx.timezone}.`,
      );
      timezone = "";
    }
    timezone ||= ctx.timezone;

    const rawCron = triggerObj.cron;
    const cron = repairCron(rawCron);
    if (cron && cronFires(cron, timezone)) {
      if (typeof rawCron === "string" && cron !== rawCron.trim()) {
        notes.push(`Rewrote the schedule "${rawCron.trim()}" as "${cron}".`);
      }
      trigger = {
        kind: "schedule",
        cron,
        timezone,
        catch_up: triggerObj.catch_up !== false,
      };
    } else {
      notes.push(
        typeof rawCron === "string" && rawCron.trim()
          ? `The suggested schedule "${rawCron.trim()}" does not parse or never fires — set it to manual. Pick a cron yourself below.`
          : "No usable schedule came back — set it to manual. Pick a cron yourself below.",
      );
    }
  }

  // Scope. A repo that is not a registered project is dropped: an automation
  // pointed at a path Argus does not know is a run that fails at 07:30.
  const known = new Map(ctx.repoRoots.map((r) => [normalizeRoot(r), r]));
  const repoRoots: string[] = [];
  const unknownRoots: string[] = [];
  const scopeObj =
    obj.scope && typeof obj.scope === "object"
      ? (obj.scope as Record<string, unknown>).repo_roots
      : undefined;
  for (const candidate of stringList(obj.repo_roots ?? scopeObj ?? obj.scope)) {
    const match = known.get(normalizeRoot(candidate));
    if (match && !repoRoots.includes(match)) {
      repoRoots.push(match);
    } else if (!match) {
      unknownRoots.push(candidate);
    }
  }
  if (unknownRoots.length > 0) {
    notes.push(
      `Dropped ${unknownRoots.length === 1 ? "a project that is not open" : "projects that are not open"}: ${unknownRoots.join(", ")}.`,
    );
  }

  const sourceIds = stringList(obj.source_ids).filter((id) =>
    ctx.sourceIds.includes(id),
  );

  const { autonomy, note } = clampGeneratedAutonomy(obj.autonomy);
  if (note) {
    notes.push(note);
  }

  return {
    input: {
      name,
      description,
      playbook,
      trigger,
      scope: { repo_roots: repoRoots },
      source_ids: sourceIds,
      autonomy,
      // Generated automations ship the way the built-in templates do: off.
      enabled: false,
    },
    notes,
  };
}

/** Pull the first JSON object out of a model reply, fenced or not. */
export function extractJsonObject(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], raw.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate.trim());
    } catch {
      continue;
    }
  }

  return null;
}

const SYSTEM_PROMPT =
  "You design automations for Argus, an agentic IDE. You reply with a single JSON object and nothing else — no prose, no code fence commentary.";

function templateExamples(): string {
  return Object.values(BUILT_IN_TEMPLATES)
    .slice(0, 3)
    .map((t) => {
      const when =
        t.trigger.kind === "schedule" ? t.trigger.cron : "manual only";
      const firstLines = t.playbook.split("\n").slice(0, 6).join("\n");

      return `### ${t.name} (${when})\n${t.description ?? ""}\n\n${firstLines}`;
    })
    .join("\n\n");
}

export function buildAuthoringPrompt(
  description: string,
  ctx: DraftContext,
  sources: { id: string; label: string; mode: string; available: boolean }[],
): string {
  const projects =
    ctx.repoRoots.length > 0
      ? ctx.repoRoots.map((r) => `- ${r}`).join("\n")
      : "- (none open)";
  const sourceLines =
    sources.length > 0
      ? sources
          .map(
            (s) =>
              `- ${s.id} — ${s.label} (${s.mode}${s.available ? "" : ", not configured"})`,
          )
          .join("\n")
      : "- (none)";

  return [
    "Draft an Argus automation from the description below.",
    "",
    "An automation is a markdown playbook plus a clock. When it fires, one agent is",
    "started in a neutral directory with the playbook as its instructions; it reads the",
    "projects in scope at their absolute paths, calls `emit_proposal` for work it wants",
    "done, and writes a report as its final message.",
    "",
    "## Open projects",
    projects,
    "",
    "## Signal sources",
    sourceLines,
    "",
    "## Examples of existing automations",
    templateExamples(),
    "",
    "## The description",
    description,
    "",
    "## Reply with",
    "A single JSON object:",
    "",
    "```json",
    "{",
    '  "name": "Short title, max 60 chars",',
    '  "description": "One sentence for the automations list",',
    '  "trigger": { "kind": "schedule", "cron": "30 7 * * 1-5", "timezone": "' +
      ctx.timezone +
      '", "catch_up": true },',
    '  "repo_roots": ["absolute path, only from the open projects above"],',
    '  "source_ids": ["only ids from the list above"],',
    '  "playbook": "# Title\\n\\nMarkdown instructions for the run\'s agent."',
    "}",
    "```",
    "",
    "Rules:",
    "- The cron is five fields, `min hour dom mon dow`. No seconds field, no `?`, no `@daily`.",
    '- Use `{ "kind": "manual" }` when the description implies no clock.',
    "- Only ever name projects and source ids from the lists above; omit them otherwise.",
    "- The playbook is the important part: say what to read, how to decide, what to",
    "  emit with `emit_proposal`, and what the final report should contain. Write it",
    "  as markdown, in the second person, and keep it specific to the description.",
    "- Do not set an autonomy level or guardrails — the user chooses those.",
  ].join("\n");
}

/**
 * Ask Claude for a draft. Throws a string on anything unusable so the IPC
 * layer can surface it verbatim; the caller never gets a half-formed draft.
 */
export async function draftAutomation(
  opts: DraftAutomationOptions,
): Promise<AutomationDraft> {
  const description = opts.description
    .trim()
    .slice(0, MAX_DESCRIPTION_INPUT_CHARS);
  if (!description) {
    throw "Describe what the automation should do first.";
  }

  const timezone =
    opts.timezone && isValidTimezone(opts.timezone)
      ? opts.timezone
      : localTimezone();
  const sources = await describeSignalSources().catch(() => []);
  const ctx: DraftContext = {
    repoRoots: collectAllProjects()
      .filter((p) => p.registered)
      .map((p) => p.path),
    sourceIds: sources.map((s) => s.id),
    timezone,
  };

  const result = await runClaudePrint({
    prompt: buildAuthoringPrompt(description, ctx, sources),
    cwd: tmpdir(),
    model: "sonnet",
    source: "automation_authoring",
    systemPrompt: SYSTEM_PROMPT,
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  if (!result) {
    throw "Claude could not be reached to draft the automation. Check that `claude` is on your PATH and logged in, then try again.";
  }

  const parsed = extractJsonObject(result);
  const draft = parsed ? sanitizeDraft(parsed, ctx) : null;
  if (!draft) {
    warn("automation authoring: unusable draft reply");
    throw "Claude did not return a usable automation. Try describing it again, with more detail about when it should run and what it should do.";
  }

  return draft;
}
