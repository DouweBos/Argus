import { z } from "zod";
import { Automation, CreateAutomationInput } from "../models/automations";
import {
  CreateTeammateInput,
  TeammateClearableField,
  OpenedTeammateThread,
  Teammate,
  TeammateDetail,
  TeammateSummary,
  TeammateTemplate,
  TeammateThread,
  UpdateTeammateInput,
} from "../models/teammates";
import { type CommandSpec, NoParams, Void } from "./spec";

const ById = z.object({ id: z.string() });

/** Host state like automations, so a desktop driving a server manages its teammates. */
export const TEAMMATE_COMMANDS = {
  teammates_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(TeammateSummary),
  },
  teammate_get: { tier: "admin", params: ById, result: TeammateDetail },
  teammate_create: {
    tier: "admin",
    params: z.object({ input: CreateTeammateInput }),
    result: Teammate,
  },
  teammate_update: {
    tier: "admin",
    params: ById.extend({
      patch: UpdateTeammateInput,
      /** Back to inheriting; a client that omits nulls says so here. */
      clear: z.array(TeammateClearableField).optional(),
    }),
    result: Teammate,
  },
  /** `keepDuties` leaves its automations behind, paused and standalone. */
  teammate_delete: {
    tier: "admin",
    params: ById.extend({ keepDuties: z.boolean() }),
    result: Void,
  },
  /** A rewritten soul for the editor. Nothing is saved. */
  teammate_soul_revise: {
    tier: "admin",
    params: z.object({
      name: z.string(),
      soul: z.string(),
      instruction: z.string(),
    }),
    result: z.object({ soul: z.string() }),
  },
  teammate_soul_save: {
    tier: "admin",
    params: ById.extend({ soul: z.string() }),
    result: Void,
  },
  teammate_templates_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(TeammateTemplate),
  },
  teammate_create_from_template: {
    tier: "admin",
    params: z.object({
      templateId: z.string(),
      repoRoots: z.array(z.string()),
    }),
    result: Teammate,
  },
  /** Null `teammateId` makes a new teammate named after the automation. */
  teammate_promote_automation: {
    tier: "admin",
    params: z.object({
      automationId: z.string(),
      teammateId: z.string().nullable(),
    }),
    result: Teammate,
  },
  teammate_add_duty: {
    tier: "admin",
    params: ById.extend({ input: CreateAutomationInput }),
    result: Automation,
  },
  teammate_remove_duty: {
    tier: "admin",
    params: z.object({ automationId: z.string() }),
    result: Automation,
  },
  teammate_threads_list: {
    tier: "admin",
    params: ById,
    result: z.array(TeammateThread),
  },
  /** No `threadId`: the newest thread, or a new one with `fresh`. */
  teammate_thread_open: {
    tier: "admin",
    params: ById.extend({
      threadId: z.string().nullish(),
      fresh: z.boolean().optional(),
    }),
    result: OpenedTeammateThread,
  },
  /** Pick a conversation back up after its last turn stopped short. */
  teammate_thread_resume: {
    tier: "admin",
    params: z.object({ threadId: z.string() }),
    result: OpenedTeammateThread,
  },
  teammate_thread_archive: {
    tier: "admin",
    params: z.object({ threadId: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
