/** Counts Claude Code's Artifact tool calls, by action, once each one's result lands. */

import type { LlmStreamEvent } from "./types";
import { capture as telemetryCapture } from "../../telemetry/telemetry";

export type ArtifactAction = "open" | "other" | "publish" | "read";

/** Calls waiting on their result: tool_use id → action. */
const pending = new Map<string, ArtifactAction>();

export function artifactAction(input: unknown): ArtifactAction {
  const action = (input as { action?: unknown } | null)?.action;
  if (action === undefined || action === "publish") {
    return "publish";
  }

  return action === "open" || action === "read" ? action : "other";
}

export function observeArtifactCalls(event: LlmStreamEvent): void {
  if (event.type === "assistant") {
    for (const block of event.message.content ?? []) {
      if (block.type === "tool_use" && block.name === "Artifact") {
        pending.set(block.id, artifactAction(block.input));
      }
    }
  } else if (event.type === "user" && pending.size > 0) {
    for (const block of event.message.content ?? []) {
      const action =
        block.type === "tool_result" ? pending.get(block.tool_use_id) : null;
      if (action) {
        pending.delete(block.tool_use_id);
        telemetryCapture("artifact_tool_used", {
          action,
          success: block.is_error !== true,
        });
      }
    }
  }
}
