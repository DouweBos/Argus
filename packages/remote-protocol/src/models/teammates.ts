import { z } from "zod";
import {
  Automation,
  AutomationGuardrails,
  AutonomyLevel,
  CreateAutomationInput,
} from "./automations";

export const TeammateColor = z.enum([
  "blue",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "yellow",
]);
export type TeammateColor = z.infer<typeof TeammateColor>;

export const TeammateSymbol = z.enum([
  "wrench",
  "eye",
  "tray",
  "shippingbox",
  "doc",
  "ant",
  "calendar",
  "leaf",
  "sparkles",
  "bolt",
  "magnifyingglass",
  "person",
]);
export type TeammateSymbol = z.infer<typeof TeammateSymbol>;

export const TeammateAvatar = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initials") }),
  z.object({ kind: z.literal("symbol"), symbol: TeammateSymbol }),
]);
export type TeammateAvatar = z.infer<typeof TeammateAvatar>;

/** A named, long-lived agent whose duties are automations. */
export const Teammate = z.object({
  id: z.string(),
  name: z.string(),
  /** Unique slug for @mentions and `.argus.json`'s disabled list. */
  handle: z.string(),
  tagline: z.string(),
  color: TeammateColor,
  avatar: TeammateAvatar,
  /** Off: no duty fires and no surface answers. Direct chat still works. */
  enabled: z.boolean(),
  scope: z.object({ repo_roots: z.array(z.string()) }),
  source_ids: z.array(z.string()),
  /** A ceiling over every duty and the conversation. */
  autonomy: AutonomyLevel.nullable(),
  guardrails: AutomationGuardrails,
  runner: z.string().nullable(),
  model: z.string().nullable(),
  claude_account_id: z.string().nullable(),
  template_id: z.string().nullable(),
  seeded_soul_hash: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Teammate = z.infer<typeof Teammate>;

export const CreateTeammateInput = z.object({
  name: z.string(),
  handle: z.string().optional(),
  tagline: z.string().optional(),
  color: TeammateColor.optional(),
  avatar: TeammateAvatar.optional(),
  enabled: z.boolean().optional(),
  scope: z.object({ repo_roots: z.array(z.string()) }).optional(),
  source_ids: z.array(z.string()).optional(),
  autonomy: AutonomyLevel.nullish(),
  guardrails: AutomationGuardrails.partial().optional(),
  runner: z.string().nullish(),
  model: z.string().nullish(),
  claude_account_id: z.string().nullish(),
  soul: z.string().optional(),
});
export type CreateTeammateInput = z.infer<typeof CreateTeammateInput>;

export const UpdateTeammateInput = Teammate.omit({
  created_at: true,
  id: true,
  seeded_soul_hash: true,
  template_id: true,
  updated_at: true,
}).partial();
export type UpdateTeammateInput = z.infer<typeof UpdateTeammateInput>;

/** One row of the teammates list. */
export const TeammateSummary = z.object({
  teammate: Teammate,
  duty_count: z.number(),
  /** Newest duty run's start, epoch ms. */
  last_run_at: z.number().nullable(),
  /** A duty has a report nobody has read. */
  has_unread_report: z.boolean(),
});
export type TeammateSummary = z.infer<typeof TeammateSummary>;

export const TeammateDetail = z.object({
  teammate: Teammate,
  /** `SOUL.md` as it is on disk. */
  soul: z.string(),
  duties: z.array(Automation),
  memory_count: z.number(),
});
export type TeammateDetail = z.infer<typeof TeammateDetail>;

export const TeammateTemplate = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  tagline: z.string(),
  color: TeammateColor,
  avatar: TeammateAvatar,
  soul: z.string(),
  autonomy: AutonomyLevel,
  source_ids: z.array(z.string()),
  requires: z.array(z.enum(["github", "gitlab", "linear", "slack"])),
  duties: z.array(CreateAutomationInput),
});
export type TeammateTemplate = z.infer<typeof TeammateTemplate>;

/** One conversation with a teammate. */
export const TeammateThread = z.object({
  id: z.string(),
  teammate_id: z.string(),
  surface: z.literal("direct"),
  /** The first thing said in it, trimmed. */
  title: z.string(),
  /** Stable across restarts; open the thread before talking to it. */
  agent_id: z.string(),
  created_at: z.number(),
  last_opened_at: z.number(),
  archived: z.boolean(),
});
export type TeammateThread = z.infer<typeof TeammateThread>;

export const OpenedTeammateThread = z.object({
  thread: TeammateThread,
  agent_id: z.string(),
  session_id: z.string(),
});
export type OpenedTeammateThread = z.infer<typeof OpenedTeammateThread>;
