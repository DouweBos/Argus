import { z } from "zod";

/** Lifecycle state of an agent process. */
export const AgentStatusValue = z.enum([
  "error",
  "idle",
  "requires_action",
  "running",
  "stopped",
]);
export type AgentStatusValue = z.infer<typeof AgentStatusValue>;

export const AgentSlashCommand = z.object({
  /** Hint for arguments (e.g. "<file>", ""). */
  argumentHint: z.string(),
  /** Description of what the command does. */
  description: z.string(),
  /** Command name without leading slash. */
  name: z.string(),
});
export type AgentSlashCommand = z.infer<typeof AgentSlashCommand>;

export const AgentModelInfo = z.object({
  description: z.string(),
  displayName: z.string(),
  supportedEffortLevels: z.array(z.string()).optional(),
  supportsEffort: z.boolean().optional(),
  supportsFastMode: z.boolean().optional(),
  value: z.string(),
});
export type AgentModelInfo = z.infer<typeof AgentModelInfo>;

/** A subagent type the CLI can dispatch to. */
export const AgentSubagentInfo = z.object({
  description: z.string(),
  model: z.string().optional(),
  name: z.string(),
});
export type AgentSubagentInfo = z.infer<typeof AgentSubagentInfo>;

export const AgentAccountInfo = z.object({
  apiProvider: z.string().optional(),
  email: z.string().optional(),
  organization: z.string().optional(),
  subscriptionType: z.string().optional(),
});
export type AgentAccountInfo = z.infer<typeof AgentAccountInfo>;

/** What the CLI reports in its initialize handshake. */
export const AgentCapabilities = z.object({
  account: AgentAccountInfo,
  agents: z.array(AgentSubagentInfo),
  available_output_styles: z.array(z.string()),
  commands: z.array(AgentSlashCommand),
  models: z.array(AgentModelInfo),
  output_style: z.string(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilities>;

/** A live agent, as the host reports it. */
export const AgentInfo = z.object({
  agent_id: z.string(),
  /**
   * Initialize-response capabilities captured during the CLI handshake.
   * Returned inline so the client has them immediately on `start_agent` — the
   * async `agent:capabilities` event can fire before listeners are wired up.
   */
  capabilities: AgentCapabilities.nullish(),
  /** Unix ms timestamp when the agent session was created. */
  created_at: z.number(),
  /**
   * Model id the agent is running with (variant suffixes like `[1m]` preserved),
   * or null if the CLI default was used.
   */
  model: z.string().nullable(),
  /** Agent that spawned this one (null for user-initiated agents). */
  parent_agent_id: z.string().nullable(),
  /**
   * Runner this agent is bound to. Inherited from the session at spawn, then
   * switchable per agent until its first prompt.
   */
  runner_id: z.string(),
  session_id: z.string(),
  status: AgentStatusValue,
});
export type AgentInfo = z.infer<typeof AgentInfo>;
