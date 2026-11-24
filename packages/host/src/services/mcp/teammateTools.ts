/**
 * `ask_teammate`: one teammate handing a question or a piece of work to
 * another by its handle, and getting the answer back as the tool result.
 *
 * Bounded so teammates can't talk among themselves forever: a chain of
 * hand-offs is at most three deep, never comes back round to a teammate
 * already in it, and stops when the day's automation budget is spent. The
 * one asked works at its own autonomy, which is never raised by who asked.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAutomation } from "../automation/manager";
import { dailyBudgetBlock } from "../automation/spend";
import { teammateCache } from "../teammate/registry";
import { teammatesActive } from "../teammate/settings";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import {
  automationRunForAgent,
  teammateThreadForAgent,
} from "./automationCaller";

export const MAX_HANDOFF_DEPTH = 3;
const HANDOFF_TIMEOUT_MS = 15 * 60_000;

/** Which teammates a hand-off thread already passed through, asker first. */
const chains = new Map<string, string[]>();
/** One standing conversation per asker thread and teammate asked. */
const handoffThreads = new Map<string, string>();

function text(body: string, isError = false) {
  return { content: [{ type: "text" as const, text: body }], isError };
}

/** The teammate a caller speaks for, and the chain it is already part of. */
function callerOf(
  callerAgentId: string | null,
): { teammateId: string; chain: string[]; threadKey: string } | null {
  const thread = teammateThreadForAgent(callerAgentId);
  if (thread) {
    return {
      teammateId: thread.teammateId,
      chain: chains.get(thread.threadId) ?? [thread.teammateId],
      threadKey: thread.threadId,
    };
  }
  const run = automationRunForAgent(callerAgentId);
  const teammateId = run ? getAutomation(run.automationId)?.teammate_id : null;

  return teammateId && run
    ? { teammateId, chain: [teammateId], threadKey: `run:${run.runId}` }
    : null;
}

/** Why a hand-off may not happen, or null when it may. */
export function handoffBlock(chain: string[], targetId: string): string | null {
  if (chain.includes(targetId)) {
    return "Refused: that teammate is already part of this conversation. Answer from what you have.";
  }
  if (chain.length >= MAX_HANDOFF_DEPTH) {
    return `Refused: hand-offs go at most ${MAX_HANDOFF_DEPTH} teammates deep. Answer from what you have.`;
  }

  return null;
}

/** Test seam. */
export function resetHandoffs(): void {
  chains.clear();
  handoffThreads.clear();
}

export function registerTeammateTools(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.tool(
    "ask_teammate",
    "Ask another Argus teammate, by its handle, a question or for a piece of work that is theirs rather than yours, and wait for its answer. Say everything it needs: it does not see your conversation. Use it sparingly; it costs a turn of theirs.",
    {
      handle: z.string().describe("The teammate's handle, without the @."),
      message: z
        .string()
        .describe("What you need from it, self-contained, in plain words."),
    },
    async ({ handle, message }) => {
      const caller = callerOf(callerAgentId);
      if (!caller) {
        return text("ask_teammate is only available to teammates.", true);
      }
      if (!teammatesActive()) {
        return text("Refused: teammates are turned off in Settings.", true);
      }
      const target = teammateCache().find(
        (t) => t.handle === handle.replace(/^@/, "").trim(),
      );
      if (!target) {
        const known = teammateCache()
          .map((t) => `@${t.handle}`)
          .join(", ");

        return text(
          `No teammate @${handle}. Teammates: ${known || "none"}.`,
          true,
        );
      }
      const blocked =
        handoffBlock(caller.chain, target.id) ?? dailyBudgetBlock();
      if (blocked) {
        telemetryCapture("teammate_handoff", {
          depth: caller.chain.length,
          outcome: blocked.includes("deep") ? "refused_depth" : "refused_loop",
        });

        return text(blocked, true);
      }

      const from = teammateCache().find((t) => t.id === caller.teammateId);
      const key = `${caller.threadKey}>${target.id}`;
      const { askTeammate } = await import("../teammate/threads");
      try {
        const asked = await askTeammate(target.id, {
          threadId: handoffThreads.get(key) ?? null,
          surface: "handoff",
          text: message,
          author: from ? `@${from.handle}` : "A teammate",
          timeoutMs: HANDOFF_TIMEOUT_MS,
        });
        handoffThreads.set(key, asked.threadId);
        chains.set(asked.threadId, [...caller.chain, target.id]);
        telemetryCapture("teammate_handoff", {
          depth: caller.chain.length,
          outcome: "delivered",
        });

        return text(
          asked.answer?.trim() ||
            `@${target.handle} didn't answer within ${HANDOFF_TIMEOUT_MS / 60_000} minutes.`,
        );
      } catch (e) {
        return text(typeof e === "string" ? e : String(e), true);
      }
    },
  );
}
