/**
 * Argus-canonical permission modes as Codex approval policy + sandbox.
 *
 * Codex has no single "mode": what it may do without asking is the sandbox,
 * and when it asks is the approval policy. The pairs below keep each mode's
 * promise — `ask` approves every write and risky command, `review` lets edits
 * through but asks before commands, `plan` can't change anything.
 */

import type { CodexApprovalPolicy, CodexSandboxMode } from "./protocol";
import type { CanonicalPermissionMode } from "../types";
import { toCanonicalPermissionMode } from "../claudeCode/permissionModes";

export interface CodexPermissions {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
}

const MODES: Record<CanonicalPermissionMode, CodexPermissions> = {
  ask: { approvalPolicy: "untrusted", sandbox: "read-only" },
  auto: { approvalPolicy: "on-request", sandbox: "workspace-write" },
  review: { approvalPolicy: "untrusted", sandbox: "workspace-write" },
  plan: { approvalPolicy: "never", sandbox: "read-only" },
  trusted: { approvalPolicy: "never", sandbox: "danger-full-access" },
};

/**
 * `guarded` (an automation holds the agent to a rung) forces every
 * non-trivial command through approval so the shell guard sees it; with
 * `editsDisallowed` edits need approval too, so the guard can refuse them.
 */
export function toCodexPermissions(
  mode: CanonicalPermissionMode | string | null | undefined,
  guarded = false,
  opts: { editsDisallowed?: boolean } = {},
): CodexPermissions {
  // Claude-native names still arrive from older callers.
  const canonical = toCanonicalPermissionMode(mode ?? "auto");
  const base = MODES[canonical];
  if (!guarded) {
    return base;
  }

  return {
    approvalPolicy: "untrusted",
    sandbox:
      opts.editsDisallowed || base.sandbox === "read-only"
        ? "read-only"
        : "workspace-write",
  };
}

/** Plan mode is a prompt-level promise too: Codex has no planning switch. */
export const PLAN_MODE_INSTRUCTIONS =
  "You are in plan mode. Investigate and propose a plan, but do not modify files or run commands that change state until the user switches you out of plan mode.";
