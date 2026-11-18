import { z } from "zod";
import {
  Blueprint,
  BlueprintDraft,
  BlueprintRun,
  CreateBlueprintInput,
  CreateProjectFromBlueprintInput,
  UpdateBlueprintInput,
} from "../models/blueprints";
import { type CommandSpec, NoParams, Void } from "./spec";

const ById = z.object({ id: z.string() });

/** Blueprints are this machine's recipes for new projects. */
export const BLUEPRINT_COMMANDS = {
  blueprints_list: {
    tier: "admin",
    params: NoParams,
    result: z.array(Blueprint),
  },
  blueprint_create: {
    tier: "admin",
    params: z.object({ input: CreateBlueprintInput }),
    result: Blueprint,
  },
  blueprint_update: {
    tier: "admin",
    params: ById.extend({ patch: UpdateBlueprintInput }),
    result: Blueprint,
  },
  blueprint_delete: { tier: "admin", params: ById, result: Void },
  /** Resolves once the run record exists; the steps carry on in the background. */
  blueprint_create_project: {
    tier: "admin",
    params: z.object({ input: CreateProjectFromBlueprintInput }),
    result: BlueprintRun,
  },
  blueprint_runs_list: {
    tier: "admin",
    params: z.object({ blueprintId: z.string().optional() }),
    result: z.array(BlueprintRun),
  },
  /** A draft read from existing projects, for the editor. Nothing is saved. */
  blueprint_draft: {
    tier: "admin",
    params: z.object({ paths: z.array(z.string()).min(1) }),
    result: BlueprintDraft,
  },
} as const satisfies Record<string, CommandSpec>;
