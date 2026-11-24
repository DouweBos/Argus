/**
 * A teammate: a named, long-lived agent. Its triggers and playbooks are
 * ordinary automations ("duties") carrying its `teammate_id`; what it adds is
 * an identity, a soul, one memory every duty shares, and conversations.
 */

import type {
  AutomationGuardrails,
  AutonomyLevel,
  CreateAutomationInput,
} from "../automation/models";

export const TEAMMATE_COLORS = [
  "blue",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "yellow",
] as const;
export type TeammateColor = (typeof TEAMMATE_COLORS)[number];

/** A fixed set every client can draw; no free-form image URLs. */
export const TEAMMATE_SYMBOLS = [
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
] as const;
export type TeammateSymbol = (typeof TEAMMATE_SYMBOLS)[number];

export type TeammateAvatar =
  | { kind: "initials" }
  | { kind: "symbol"; symbol: TeammateSymbol };

export interface Teammate {
  id: string;
  name: string;
  /** Unique slug, used for @mentions and in `.argus.json`'s disabled list. */
  handle: string;
  tagline: string;
  color: TeammateColor;
  avatar: TeammateAvatar;
  /** Off: no duty fires and no surface answers. Direct chat still works. */
  enabled: boolean;
  scope: { repo_roots: string[] };
  source_ids: string[];
  /** A ceiling over every duty and the conversation; null inherits the app's. */
  autonomy: AutonomyLevel | null;
  guardrails: AutomationGuardrails;
  runner: string | null;
  model: string | null;
  claude_account_id: string | null;
  template_id: string | null;
  /** Hash of the soul as seeded; still matching means a release may update it. */
  seeded_soul_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateTeammateInput {
  name: string;
  handle?: string;
  tagline?: string;
  color?: TeammateColor;
  avatar?: TeammateAvatar;
  enabled?: boolean;
  scope?: { repo_roots: string[] };
  source_ids?: string[];
  autonomy?: AutonomyLevel | null;
  guardrails?: Partial<AutomationGuardrails>;
  runner?: string | null;
  model?: string | null;
  claude_account_id?: string | null;
  soul?: string;
}

export type UpdateTeammateInput = Partial<
  Omit<
    Teammate,
    "created_at" | "id" | "seeded_soul_hash" | "template_id" | "updated_at"
  >
>;

/** A starting teammate in the gallery. Nothing is created until picked. */
export interface TeammateTemplate {
  id: string;
  name: string;
  handle: string;
  tagline: string;
  color: TeammateColor;
  avatar: TeammateAvatar;
  soul: string;
  autonomy: AutonomyLevel;
  source_ids: string[];
  /** What it needs connected to be any use; the gallery greys out the rest. */
  requires: ("github" | "gitlab" | "linear" | "slack")[];
  duties: CreateAutomationInput[];
}
