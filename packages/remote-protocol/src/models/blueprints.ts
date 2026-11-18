import { z } from "zod";

/** A local project the new project's agent studies. */
export const BlueprintReference = z.object({
  /** Absolute path to the project's repo root. */
  path: z.string(),
  /** What to take from it, e.g. "release workflow and signing". */
  note: z.string(),
});
export type BlueprintReference = z.infer<typeof BlueprintReference>;

/** Where the new project's first files come from. */
export const BlueprintScaffold = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("empty") }),
  z.object({
    kind: z.literal("github_template"),
    /** `owner/name` of a GitHub template repository. */
    repo: z.string(),
  }),
]);
export type BlueprintScaffold = z.infer<typeof BlueprintScaffold>;

export const BlueprintVisibility = z.enum(["private", "public"]);
export type BlueprintVisibility = z.infer<typeof BlueprintVisibility>;

export const BlueprintGithub = z.object({
  /** Create a GitHub repository for the project. */
  enabled: z.boolean(),
  /** User or organisation; empty means the signed-in `gh` user. */
  owner: z.string(),
  visibility: BlueprintVisibility,
});
export type BlueprintGithub = z.infer<typeof BlueprintGithub>;

export const BlueprintPermissionMode = z.enum([
  "ask",
  "auto",
  "plan",
  "review",
  "trusted",
]);
export type BlueprintPermissionMode = z.infer<typeof BlueprintPermissionMode>;

/** Who builds the project. Null fields inherit the app defaults. */
export const BlueprintAgent = z.object({
  runner: z.string().nullable(),
  model: z.string().nullable(),
  permission_mode: BlueprintPermissionMode.nullable(),
});
export type BlueprintAgent = z.infer<typeof BlueprintAgent>;

/** A user-defined recipe for starting a new project. */
export const Blueprint = z.object({
  id: z.string(),
  name: z.string(),
  /** One line, shown in the picker. */
  summary: z.string(),
  /** Folder new projects are created in, e.g. `~/Work/Apps`. */
  parent_dir: z.string(),
  references: z.array(BlueprintReference),
  scaffold: BlueprintScaffold,
  github: BlueprintGithub,
  /** A reference whose machine-local project config the new project copies. */
  copy_project_settings_from: z.string().nullable(),
  /** Markdown. `{{name}}`, `{{description}}`, `{{repo}}` and `{{path}}` are filled in. */
  instructions: z.string(),
  agent: BlueprintAgent,
  created_at: z.number(),
  updated_at: z.number(),
});
export type Blueprint = z.infer<typeof Blueprint>;

export const BlueprintRunStatus = z.enum(["done", "failed", "running"]);
export type BlueprintRunStatus = z.infer<typeof BlueprintRunStatus>;

export const BlueprintStepKey = z.enum([
  "create_repo",
  "register",
  "start_agent",
  "validate",
]);
export type BlueprintStepKey = z.infer<typeof BlueprintStepKey>;

export const BlueprintStepStatus = z.enum([
  "done",
  "failed",
  "pending",
  "running",
]);
export type BlueprintStepStatus = z.infer<typeof BlueprintStepStatus>;

export const BlueprintStep = z.object({
  key: BlueprintStepKey,
  status: BlueprintStepStatus,
  error: z.string().nullable(),
});
export type BlueprintStep = z.infer<typeof BlueprintStep>;

/** One project created from a blueprint. */
export const BlueprintRun = z.object({
  id: z.string(),
  blueprint_id: z.string(),
  project_name: z.string(),
  repo_root: z.string(),
  /** The GitHub URL, once the repository exists. */
  repo_url: z.string().nullable(),
  status: BlueprintRunStatus,
  steps: z.array(BlueprintStep),
  session_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  started_at: z.number(),
  finished_at: z.number().nullable(),
});
export type BlueprintRun = z.infer<typeof BlueprintRun>;

export const CreateBlueprintInput = Blueprint.omit({
  created_at: true,
  id: true,
  updated_at: true,
}).extend({
  /** Set when saving a generated draft, so drafts that get kept are counted. */
  from_draft: z.boolean().optional(),
});
export type CreateBlueprintInput = z.infer<typeof CreateBlueprintInput>;

export const UpdateBlueprintInput = Blueprint.omit({
  created_at: true,
  id: true,
  updated_at: true,
}).partial();
export type UpdateBlueprintInput = z.infer<typeof UpdateBlueprintInput>;

/** Per-project changes to the blueprint's defaults. */
export const BlueprintOverrides = z.object({
  parent_dir: z.string().optional(),
  owner: z.string().optional(),
  visibility: BlueprintVisibility.optional(),
  github_enabled: z.boolean().optional(),
});
export type BlueprintOverrides = z.infer<typeof BlueprintOverrides>;

export const CreateProjectFromBlueprintInput = z.object({
  blueprintId: z.string(),
  name: z.string(),
  description: z.string(),
  overrides: BlueprintOverrides.optional(),
});
export type CreateProjectFromBlueprintInput = z.infer<
  typeof CreateProjectFromBlueprintInput
>;

/** A generated blueprint for the editor to review. Nothing is saved. */
export const BlueprintDraft = z.object({
  name: z.string(),
  summary: z.string(),
  parent_dir: z.string(),
  instructions: z.string(),
  scaffold: BlueprintScaffold,
  github: BlueprintGithub,
  references: z.array(BlueprintReference),
  copy_project_settings_from: z.string().nullable(),
});
export type BlueprintDraft = z.infer<typeof BlueprintDraft>;
