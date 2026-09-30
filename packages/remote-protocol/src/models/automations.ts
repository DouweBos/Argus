import { z } from "zod";

/**
 * The autonomy ladder. Each rung strictly contains the one before it:
 * `propose` writes a proposal and touches nothing, `draft` implements and
 * commits, `pr` also pushes a draft PR, `auto_merge` merges on green CI.
 */
export const AutonomyLevel = z.enum(["auto_merge", "draft", "pr", "propose"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
