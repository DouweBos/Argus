import { z } from "zod";

/** Which app asked for the clone, for telemetry. */
export const CloneSource = z.enum(["android", "ios", "mac", "web"]);
export type CloneSource = z.infer<typeof CloneSource>;

/** How the repository was named: a URL, an ssh address or `owner/repo`. */
export const CloneUrlKind = z.enum(["https", "shorthand", "ssh"]);
export type CloneUrlKind = z.infer<typeof CloneUrlKind>;

/** The `git clone --progress` stage being reported. */
export const ClonePhase = z.enum([
  "checking_out",
  "compressing",
  "connecting",
  "counting",
  "receiving",
  "resolving",
]);
export type ClonePhase = z.infer<typeof ClonePhase>;

export const CloneStatus = z.enum(["cancelled", "done", "failed", "running"]);
export type CloneStatus = z.infer<typeof CloneStatus>;

/** One clone on the host, from start to the project it became. */
export const CloneJob = z.object({
  id: z.string(),
  /** The address as given, trimmed. */
  url: z.string(),
  url_kind: CloneUrlKind,
  /** The folder the repository lands in, and the project's repo root once done. */
  path: z.string(),
  status: CloneStatus,
  phase: ClonePhase,
  /** 0-100 within `phase`; null while git hasn't said. */
  percent: z.number().nullable(),
  error: z.string().nullable(),
  started_at: z.number(),
  finished_at: z.number().nullable(),
});
export type CloneJob = z.infer<typeof CloneJob>;

/** Where a new clone goes unless the user picks somewhere else. */
export const CloneDefaults = z.object({
  /** The remembered folder, else the folder most projects sit in, else `~/Developer`. */
  parent_dir: z.string(),
  /** Folders worth offering: the default, then the parents of existing projects. */
  parents: z.array(z.string()),
  /** `owner/repo` clones through `gh` when true, over https otherwise. */
  gh_available: z.boolean(),
});
export type CloneDefaults = z.infer<typeof CloneDefaults>;

export const ClonePreviewInput = z.object({
  url: z.string(),
  parent_dir: z.string(),
  /** Empty means the repository's own name. */
  name: z.string().optional(),
});
export type ClonePreviewInput = z.infer<typeof ClonePreviewInput>;

/** What a clone with these fields would do, or why it can't start. */
export const ClonePreview = z.object({
  /** Null when the address isn't one Argus can clone. */
  url_kind: CloneUrlKind.nullable(),
  /** The folder name used: the one given, else the repository's. */
  name: z.string(),
  path: z.string(),
  /** Why it can't start (bad address, bad name, folder exists); null when it can. */
  problem: z.string().nullable(),
});
export type ClonePreview = z.infer<typeof ClonePreview>;

export const StartCloneInput = ClonePreviewInput.extend({
  source: CloneSource,
});
export type StartCloneInput = z.infer<typeof StartCloneInput>;
