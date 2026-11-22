import type { LlmRunner } from "../types";

/** Claude Code, or a runner derived from it. */
export function isClaudeBased(
  runner: Pick<LlmRunner, "baseRunnerId" | "id">,
): boolean {
  return (runner.baseRunnerId ?? runner.id) === "claude-code";
}
