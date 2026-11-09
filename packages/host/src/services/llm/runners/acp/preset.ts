/**
 * What tells one ACP agent from another: how to start it, how to install and
 * sign in to it, and the few quirks its vendor needs worked around.
 */

import type { CanonicalPermissionMode } from "../types";

export interface AcpPreset {
  /** Runner id, e.g. `gemini`. */
  id: string;
  displayName: string;
  /** Binaries to look for on PATH; the first found runs. */
  bins: string[];
  /** Arguments that start the agent's ACP server. */
  args: string[] | ((binPath: string) => Promise<string[]>);
  /** How to install the CLI, shown when it's missing. */
  installHint: string;
  /** How to sign in, shown when the agent says it isn't. */
  loginHint: string;
  /** Auth method to call when `session/new` says it needs one. */
  authMethodId?: string | (() => string);
  /** The agent's own mode id for an Argus mode, set when it offers one. */
  modeIds?: Partial<Record<CanonicalPermissionMode, string>>;
  /** Session config values for an Argus mode (e.g. an autopilot switch). */
  configFor?: (mode: CanonicalPermissionMode) => Record<string, string>;
  /** The agent saves "always allow" beyond the session, so Argus never picks it. */
  noAlwaysAllow?: boolean;
  /** How it resumes a conversation, when it gets this wrong on its own. */
  resumeVia?: "load" | "resume";
  initializeMeta?: Record<string, unknown>;
  cancelMeta?: Record<string, unknown>;
  /** Carries the system prompt in `session/new`'s `_meta` instead of the first prompt. */
  sessionMeta?: (systemPrompt: string) => Record<string, unknown>;
  env?: Record<string, string>;
}
