/**
 * Teammates: create, edit, delete, and the duties (automations) they own.
 *
 * Ownership moves memory with it — a promoted automation's memories join its
 * teammate's, so every duty and the conversation read one memory.
 */

import type {
  CreateTeammateInput,
  Teammate,
  TeammateAvatar,
  TeammateColor,
  UpdateTeammateInput,
} from "./models";
import type {
  Automation,
  AutomationMemory,
  CreateAutomationInput,
  SaveMemoryInput,
} from "../automation/models";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { isAutonomyLevel, normalizeGuardrails } from "../automation/guardrails";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  hasUnreadReport,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
} from "../automation/manager";
import {
  deleteMemory,
  listMemories,
  saveMemory,
} from "../automation/memory/store";
import { memoryDirFor } from "../automation/paths";
import { playbookHash } from "../automation/templateSync";
import { getClaudeAccount } from "../claudeAuth/accounts";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { TEAMMATE_COLORS, TEAMMATE_SYMBOLS } from "./models";
import { teammateDir } from "./paths";
import { findTeammate, persistTeammates, teammateCache } from "./registry";
import { readSoul, writeSoul } from "./soul";
import { getTeammateTemplate } from "./templates";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function changed(): void {
  emitHostEvent("teammates:changed", {});
}

export function listTeammates(): Teammate[] {
  return teammateCache().map((t) => ({ ...t }));
}

export function getTeammate(id: string): Teammate | null {
  const teammate = findTeammate(id);

  return teammate ? { ...teammate } : null;
}

export function requireTeammate(id: string): Teammate {
  const teammate = findTeammate(id);
  if (!teammate) {
    throw `Teammate not found: ${id}`;
  }

  return teammate;
}

export function dutiesOf(teammateId: string): Automation[] {
  return listAutomations().filter((a) => a.teammate_id === teammateId);
}

/** "Ci Fixer" → "ci-fixer"; a taken one gets a number. */
export function handleFor(name: string, takenBy: string | null = null): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "teammate";
  const taken = new Set(
    teammateCache()
      .filter((t) => t.id !== takenBy)
      .map((t) => t.handle),
  );
  let handle = base;
  for (let n = 2; taken.has(handle); n++) {
    handle = `${base}-${n}`;
  }

  return handle;
}

function assertHandle(handle: string, teammateId: string | null): void {
  if (!HANDLE_PATTERN.test(handle)) {
    throw `A handle is a lowercase slug (a-z, 0-9, -) of at most 32 characters, got "${handle}".`;
  }
  if (teammateCache().some((t) => t.handle === handle && t.id !== teammateId)) {
    throw `Another teammate is already @${handle}.`;
  }
}

function assertColor(color: TeammateColor): void {
  if (!(TEAMMATE_COLORS as readonly string[]).includes(color)) {
    throw `Unknown color: ${color}`;
  }
}

function assertAvatar(avatar: TeammateAvatar): void {
  if (
    avatar.kind === "symbol" &&
    !(TEAMMATE_SYMBOLS as readonly string[]).includes(avatar.symbol)
  ) {
    throw `Unknown avatar symbol: ${avatar.symbol}`;
  }
}

function assertAccount(accountId: string | null | undefined): void {
  if (accountId && !getClaudeAccount(accountId)) {
    throw `Unknown Claude account: ${accountId}`;
  }
}

function pickColor(): TeammateColor {
  const used = new Set(teammateCache().map((t) => t.color));

  return TEAMMATE_COLORS.find((c) => !used.has(c)) ?? TEAMMATE_COLORS[0];
}

export function createTeammate(
  input: CreateTeammateInput,
  origin: { template_id?: string } = {},
): Teammate {
  const name = input.name.trim();
  if (!name) {
    throw "A teammate needs a name.";
  }
  const handle = input.handle?.trim() || handleFor(name);
  assertHandle(handle, null);
  const color = input.color ?? pickColor();
  assertColor(color);
  const avatar = input.avatar ?? { kind: "initials" };
  assertAvatar(avatar);
  assertAccount(input.claude_account_id);
  if (input.autonomy != null && !isAutonomyLevel(input.autonomy)) {
    throw `Unknown autonomy: ${String(input.autonomy)}`;
  }

  const now = Date.now();
  const soul = input.soul?.trim() ?? "";
  const teammate: Teammate = {
    id: crypto.randomUUID(),
    name,
    handle,
    tagline: input.tagline?.trim() ?? "",
    color,
    avatar,
    enabled: input.enabled ?? false,
    scope: { repo_roots: input.scope?.repo_roots ?? [] },
    source_ids: input.source_ids ?? [],
    autonomy: input.autonomy ?? null,
    guardrails: normalizeGuardrails(input.guardrails),
    runner: input.runner ?? null,
    model: input.model ?? null,
    claude_account_id: input.claude_account_id ?? null,
    template_id: origin.template_id ?? null,
    seeded_soul_hash: origin.template_id && soul ? playbookHash(soul) : null,
    created_at: now,
    updated_at: now,
  };
  writeSoul(teammate.id, soul);
  teammateCache().push(teammate);
  persistTeammates();
  changed();
  info(`Created teammate ${teammate.id} (@${teammate.handle})`);

  return { ...teammate };
}

export function updateTeammate(
  id: string,
  patch: UpdateTeammateInput,
  clear: ("autonomy" | "claude_account_id" | "model" | "runner")[] = [],
): Teammate {
  const teammate = requireTeammate(id);
  if (clear.length > 0) {
    patch = { ...patch, ...Object.fromEntries(clear.map((f) => [f, null])) };
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    throw "A teammate needs a name.";
  }
  if (patch.handle !== undefined) {
    assertHandle(patch.handle, id);
  }
  if (patch.color !== undefined) {
    assertColor(patch.color);
  }
  if (patch.avatar !== undefined) {
    assertAvatar(patch.avatar);
  }
  if (patch.claude_account_id !== teammate.claude_account_id) {
    assertAccount(patch.claude_account_id);
  }
  if (patch.autonomy != null && !isAutonomyLevel(patch.autonomy)) {
    throw `Unknown autonomy: ${String(patch.autonomy)}`;
  }

  const wasEnabled = teammate.enabled;
  Object.assign(teammate, patch, { updated_at: Date.now() });
  teammate.name = teammate.name.trim();
  teammate.guardrails = normalizeGuardrails(teammate.guardrails);
  persistTeammates();

  // The teammate's switch is its duties' switch; each keeps its own clock.
  if (patch.enabled !== undefined && patch.enabled !== wasEnabled) {
    for (const duty of dutiesOf(id)) {
      try {
        updateAutomation(duty.id, { enabled: patch.enabled });
      } catch (e) {
        warn(`teammate ${id}: could not switch duty ${duty.id}: ${String(e)}`);
      }
    }
  }
  changed();

  return { ...teammate };
}

export function saveTeammateSoul(id: string, soul: string): void {
  requireTeammate(id);
  writeSoul(id, soul);
  telemetryCapture("teammate_soul_changed", { via: "edit" });
  changed();
}

/**
 * Remove a teammate. Its duties are deleted, or kept as standalone paused
 * automations — which then start a memory of their own.
 */
export function deleteTeammate(id: string, keepDuties: boolean): void {
  requireTeammate(id);
  const duties = dutiesOf(id);
  for (const duty of duties) {
    if (keepDuties) {
      updateAutomation(duty.id, { enabled: false });
      setDutyOwner(duty.id, null);
    } else {
      deleteAutomation(duty.id);
    }
  }

  const list = teammateCache();
  list.splice(
    list.findIndex((t) => t.id === id),
    1,
  );
  persistTeammates();
  try {
    fs.rmSync(teammateDir(id), { force: true, recursive: true });
  } catch (e) {
    warn(`teammate ${id}: could not remove its folder: ${String(e)}`);
  }
  telemetryCapture("teammate_deleted", {
    kept_duties: keepDuties,
    duty_count_bucket: countBucket(duties.length),
  });
  changed();
}

function countBucket(n: number): "0" | "1" | "2-5" | "6+" {
  if (n <= 1) {
    return n === 0 ? "0" : "1";
  }

  return n <= 5 ? "2-5" : "6+";
}

/** The one write that changes ownership; `updateAutomation` refuses it. */
function setDutyOwner(automationId: string, teammateId: string | null): void {
  const automation = getAutomation(automationId);
  if (!automation) {
    throw `Automation not found: ${automationId}`;
  }
  updateAutomation(automationId, {}, { teammate_id: teammateId });
}

/** A new automation that is a duty from the start. */
export function addDuty(
  teammateId: string,
  input: CreateAutomationInput,
): Automation {
  const teammate = requireTeammate(teammateId);

  return createAutomation({
    ...input,
    scope: input.scope ?? teammate.scope,
    source_ids: input.source_ids ?? teammate.source_ids,
    runner: input.runner ?? teammate.runner,
    model: input.model ?? teammate.model,
    claude_account_id: input.claude_account_id ?? teammate.claude_account_id,
    teammate_id: teammateId,
  });
}

/** Detach a duty; it keeps running as a standalone automation, memory-less. */
export function removeDuty(automationId: string): Automation {
  setDutyOwner(automationId, null);
  changed();

  return getAutomation(automationId)!;
}

/**
 * Turn a standalone automation into a teammate's duty — a new teammate named
 * after it unless one is given. Its memories move into the teammate's.
 */
export function promoteAutomation(
  automationId: string,
  teammateId: string | null,
): Teammate {
  // `listAutomations`, not `getAutomation`: a quick run has nothing to promote.
  const automation = listAutomations().find((a) => a.id === automationId);
  if (!automation) {
    throw `Automation not found: ${automationId}`;
  }
  if (automation.teammate_id) {
    throw "That automation already belongs to a teammate.";
  }

  const teammate = teammateId
    ? requireTeammate(teammateId)
    : createTeammate(
        {
          name: automation.name,
          tagline: automation.description,
          enabled: automation.enabled,
          scope: automation.scope,
          source_ids: automation.source_ids,
          autonomy: automation.autonomy,
          guardrails: automation.guardrails,
          runner: automation.runner,
          model: automation.model,
          claude_account_id: automation.claude_account_id,
        },
        {},
      );
  moveMemories(automationId, teammate.id);
  setDutyOwner(automationId, teammate.id);
  if (!teammateId) {
    telemetryCapture("teammate_created", {
      source: "promoted",
      template_id: "none",
    });
  }
  changed();

  return { ...teammate };
}

/** Merge an automation's memories into a teammate's; a clash keeps both. */
function moveMemories(automationId: string, teammateId: string): void {
  const from = { kind: "automation", id: automationId } as const;
  const to = { kind: "teammate", id: teammateId } as const;
  const existing = new Set(listMemories(to).map((m) => m.name));
  for (const memory of listMemories(from)) {
    const name = existing.has(memory.name)
      ? `${memory.name}-${automationId.slice(0, 8)}`.slice(0, 64)
      : memory.name;
    try {
      saveMemory(to, { ...memory, name });
    } catch (e) {
      warn(
        `teammate ${teammateId}: memory ${memory.name} not moved: ${String(e)}`,
      );

      return;
    }
  }
  try {
    fs.rmSync(memoryDirFor(from), { force: true, recursive: true });
  } catch (e) {
    warn(`automation ${automationId}: old memory not removed: ${String(e)}`);
  }
}

/** Where a teammate's files live, for "Show in Finder". */
export function teammateFolder(id: string): string {
  requireTeammate(id);

  return path.resolve(teammateDir(id));
}

/** A gallery template made real: the teammate, its soul and its duties. */
export function createTeammateFromTemplate(
  templateId: string,
  repoRoots: string[],
): Teammate {
  const template = getTeammateTemplate(templateId);
  if (!template) {
    throw `Unknown teammate template: ${templateId}`;
  }
  const teammate = createTeammate(
    {
      name: template.name,
      handle: handleFor(template.handle),
      tagline: template.tagline,
      color: template.color,
      avatar: template.avatar,
      enabled: false,
      scope: { repo_roots: repoRoots },
      source_ids: template.source_ids,
      autonomy: template.autonomy,
      soul: template.soul,
    },
    { template_id: template.id },
  );
  for (const duty of template.duties) {
    addDuty(teammate.id, {
      ...duty,
      enabled: false,
      scope: { repo_roots: repoRoots },
      source_ids: duty.source_ids ?? template.source_ids,
    });
  }
  telemetryCapture("teammate_created", {
    source: "template",
    template_id: template.id,
  });

  return getTeammate(teammate.id)!;
}

export interface TeammateSummary {
  teammate: Teammate;
  duty_count: number;
  last_run_at: number | null;
  has_unread_report: boolean;
}

export function teammateSummaries(): TeammateSummary[] {
  return listTeammates().map((teammate) => {
    const dutyIds = new Set(dutiesOf(teammate.id).map((d) => d.id));
    const runs = listAutomationRuns().filter((r) =>
      dutyIds.has(r.automation_id),
    );

    return {
      teammate,
      duty_count: dutyIds.size,
      last_run_at: runs.reduce<number | null>(
        (newest, r) =>
          newest === null || r.started_at > newest ? r.started_at : newest,
        null,
      ),
      has_unread_report: runs.some(hasUnreadReport),
    };
  });
}

export interface TeammateDetail {
  teammate: Teammate;
  soul: string;
  duties: Automation[];
  memory_count: number;
}

export function teammateDetail(id: string): TeammateDetail {
  const teammate = requireTeammate(id);

  return {
    teammate: { ...teammate },
    soul: readSoul(id),
    duties: dutiesOf(id),
    memory_count: listMemories({ kind: "teammate", id }).length,
  };
}

export function createBlankTeammate(input: CreateTeammateInput): Teammate {
  const teammate = createTeammate(input);
  telemetryCapture("teammate_created", {
    source: "blank",
    template_id: "none",
  });

  return teammate;
}

export function listTeammateMemories(id: string): AutomationMemory[] {
  requireTeammate(id);

  return listMemories({ kind: "teammate", id });
}

export function saveTeammateMemory(
  id: string,
  input: SaveMemoryInput,
): AutomationMemory {
  requireTeammate(id);

  return saveMemory({ kind: "teammate", id }, input);
}

export function deleteTeammateMemory(id: string, name: string): void {
  requireTeammate(id);
  deleteMemory({ kind: "teammate", id }, name);
}
