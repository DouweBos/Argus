/**
 * What an ACP agent's permission request gets under each Argus mode.
 *
 * ACP agents ask the client before acting, so Argus is the policy: `ask`
 * asks about everything, `review` lets reads and worktree edits through but
 * asks before commands, `auto` lets everything through except changes
 * outside the worktree, `trusted` allows all, and `plan` refuses anything
 * that changes state.
 */

import type { AcpPermissionOption, AcpToolCall } from "./protocol";
import type { CanonicalPermissionMode } from "../types";
import path from "node:path";
import { matchesDisallowed } from "../codex/disallowed";

export type AcpVerdict = "allow" | "ask" | "deny";

const READ_ONLY = new Set(["fetch", "read", "search", "switch_mode", "think"]);
const FILE_CHANGES = new Set(["delete", "edit", "move"]);

export function acpVerdict(
  mode: CanonicalPermissionMode,
  call: AcpToolCall,
  ctx: { cwd: string; disallowed: string[]; toolName: string },
): AcpVerdict {
  const kind = call.kind ?? "other";
  const command = kind === "execute" ? commandText(call) : null;
  if (matchesDisallowed(ctx.disallowed, ctx.toolName, command)) {
    return "deny";
  }
  // Edits a guard disallows are refused whatever the mode.
  if (FILE_CHANGES.has(kind) && ctx.disallowed.includes("Edit")) {
    return "deny";
  }
  const guarded = ctx.disallowed.length > 0;
  const inside = FILE_CHANGES.has(kind) && pathsInside(call, ctx.cwd);
  switch (mode) {
    case "trusted":
      return guarded && kind === "execute" ? "ask" : "allow";
    case "auto":
      if (READ_ONLY.has(kind) || inside) {
        return "allow";
      }

      return FILE_CHANGES.has(kind) || guarded ? "ask" : "allow";
    case "review":
      return READ_ONLY.has(kind) || inside ? "allow" : "ask";
    case "plan":
      return READ_ONLY.has(kind) ? "allow" : "deny";
    default:
      return "ask";
  }
}

/**
 * The option a decision picks. Auto-approvals stay one-off; "always" is the
 * user's call, and some agents persist it project-wide, so a preset can
 * refuse it.
 */
export function pickOption(
  options: AcpPermissionOption[],
  decision: "allow" | "deny",
  always: boolean,
): string | null {
  let order = ["reject_once", "reject_always"];
  if (decision === "allow") {
    order = always
      ? ["allow_always", "allow_once"]
      : ["allow_once", "allow_always"];
  }
  for (const kind of order) {
    const hit = options.find((o) => o.kind === kind);
    if (hit) {
      return hit.optionId;
    }
  }

  return null;
}

function commandText(call: AcpToolCall): string | null {
  const raw = call.rawInput as Record<string, unknown> | null | undefined;
  const cmd = raw?.command ?? raw?.cmd;
  if (typeof cmd === "string") {
    return cmd;
  }
  if (Array.isArray(cmd)) {
    return cmd.map(String).join(" ");
  }

  return call.title ?? null;
}

/** Every path the call touches sits inside the worktree (none known: no). */
function pathsInside(call: AcpToolCall, cwd: string): boolean {
  const paths = [
    ...(call.locations ?? []).map((l) => l.path),
    ...(call.content ?? []).flatMap((c) => (c.type === "diff" ? [c.path] : [])),
  ];
  if (paths.length === 0) {
    return false;
  }
  const root = path.resolve(cwd);

  return paths.every((p) => {
    const rel = path.relative(root, path.resolve(root, p));

    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

/** Plan mode is a prompt-level promise too, for agents without a plan mode. */
export const PLAN_MODE_INSTRUCTIONS =
  "You are in plan mode. Investigate and propose a plan, but do not modify files or run commands that change state until the user switches you out of plan mode.";
