/**
 * Organization — a user-defined grouping of related repos/projects that
 * collaborate on the same product (e.g. backend + frontend + mobile).
 *
 * Each organization carries a system prompt describing which repo implements
 * which part of the system. When agents spawn inside a member repo, the org
 * system prompt is prepended so they understand their place in the wider
 * product.
 *
 * Organizations also host orchestrator agents that fan work out across their
 * member repos.
 */

/** Which slice of the product a repo implements within its organization. */
export interface OrganizationMember {
  /** Absolute path to the repo root. */
  repo_root: string;
  /** Human-readable description of this repo's role in the org. */
  role: string;
}

/** A named group of repos that collaborate on one product. */
export interface Organization {
  /** Stable UUID. */
  id: string;
  /** User-facing name. */
  name: string;
  /** Optional one-line description. */
  description: string;
  /**
   * System prompt injected into agents spawned in member repos, describing
   * the org's overall product and how the repos fit together.
   */
  system_prompt: string;
  /** Accent color (hex) used to visually group the org in the UI. */
  accent: string;
  /** Member repos and their roles. */
  members: OrganizationMember[];
  /** Unix ms. */
  created_at: number;
  /** Unix ms. */
  updated_at: number;
}

/** Shape returned by IPC/MCP list calls — matches `Organization` exactly. */
export type OrganizationSummary = Organization;

/** Default accent palette, used when a new org is created without one. */
export const ORGANIZATION_ACCENTS = [
  "#7c5cfc",
  "#4d9fff",
  "#00d4aa",
  "#f5a623",
  "#ff4466",
  "#55556a",
] as const;
