import { z } from "zod";

/** A command against one session's worktree. */
export const SessionId = z.object({ id: z.string() });

/** A command against a project, keyed by its repo root. */
export const RepoRoot = z.object({ repoRoot: z.string() });

export const SessionFilePath = SessionId.extend({ filePath: z.string() });

export const RepoBranch = RepoRoot.extend({ branch: z.string() });
