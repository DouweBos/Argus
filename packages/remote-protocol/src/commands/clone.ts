import { z } from "zod";
import {
  CloneDefaults,
  CloneJob,
  ClonePreview,
  ClonePreviewInput,
  StartCloneInput,
} from "../models/clone";
import { type CommandSpec, NoParams } from "./spec";

/** Cloning a repository from a URL into a new project on this machine. */
export const CLONE_COMMANDS = {
  clone_defaults: { tier: "admin", params: NoParams, result: CloneDefaults },
  clone_preview: {
    tier: "admin",
    params: z.object({ input: ClonePreviewInput }),
    result: ClonePreview,
  },
  /** Resolves once the clone has started; `project:clone` events follow it. */
  clone_start: {
    tier: "admin",
    params: z.object({ input: StartCloneInput }),
    result: CloneJob,
  },
  clone_cancel: {
    tier: "admin",
    params: z.object({ id: z.string() }),
    result: z.object({ accepted: z.boolean() }),
  },
  clones_list: { tier: "admin", params: NoParams, result: z.array(CloneJob) },
} as const satisfies Record<string, CommandSpec>;
