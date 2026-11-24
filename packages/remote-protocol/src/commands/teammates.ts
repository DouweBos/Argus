import { z } from "zod";
import { Automation, CreateAutomationInput } from "../models/automations";
import {
  CreateTeammateInput,
  Teammate,
  TeammateDetail,
  TeammateSummary,
  TeammateTemplate,
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
    params: ById.extend({ patch: UpdateTeammateInput }),
    result: Teammate,
  },
  /** `keepDuties` leaves its automations behind, paused and standalone. */
  teammate_delete: {
    tier: "admin",
    params: ById.extend({ keepDuties: z.boolean() }),
    result: Void,
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
} as const satisfies Record<string, CommandSpec>;
