/**
 * `open_session_pr` — the only way an automation run may push.
 *
 * The post-conditions live here rather than at proposal time because what a
 * branch actually touched is only knowable once it exists: `max_files_changed`
 * and `path_denylist` are checked against the session's real `git status`
 * immediately before the push.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { evaluatePush } from "../automation/guardrails";
import { ghPrCreate } from "../github/prActions";
import { getSessionStatus, pushSessionBranch } from "../session/sessionOps";
import { callerPolicy, sessionById } from "./automationGuards";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Repo-relative paths from `git status --short`, renames resolved to the new name. */
export function changedPathsFromStatus(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const rest = line.slice(3);
      const arrow = rest.indexOf(" -> ");

      return arrow >= 0 ? rest.slice(arrow + 4) : rest;
    })
    .map((p) => p.replace(/^"|"$/g, ""));
}

export function registerAutomationPrTool(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.tool(
    "open_session_pr",
    "Push a session's branch and open a draft pull request for it. Only available to automation runs, and only when this automation's autonomy reaches 'pr'. The session's changes are checked against the guardrails first — too many files, or a file under a denied path, and the push is refused.",
    {
      session_id: z
        .string()
        .describe("Session id returned by create_session or spawn_agent."),
      title: z.string().describe("Pull request title. One line, imperative."),
      body: z
        .string()
        .describe("Pull request body. Markdown. Say what changed and why."),
    },
    async ({ session_id, title, body }) => {
      const session = sessionById(session_id);
      if (!session) {
        return textResult(`Session not found: ${session_id}`, true);
      }

      const resolved = callerPolicy(callerAgentId, session.repo_root);
      if (!resolved) {
        return textResult(
          "open_session_pr is only available to automation runs.",
          true,
        );
      }

      let status: string;
      try {
        status = await getSessionStatus(session.id);
      } catch (e) {
        return textResult(String(e), true);
      }

      const decision = evaluatePush({
        autonomy: resolved.policy.autonomy,
        guardrails: resolved.policy.guardrails,
        changedPaths: changedPathsFromStatus(status),
      });
      if (!decision.allowed) {
        return textResult(`Refused: ${decision.reason}.`, true);
      }

      try {
        await pushSessionBranch(session.id);
        const pr = await ghPrCreate({
          repoRoot: session.path,
          title,
          body,
          base: session.base_branch ?? "main",
          head: session.branch,
          draft: true,
        });

        return textResult(
          JSON.stringify({ pr_url: pr.url, pr_number: pr.number }, null, 2),
        );
      } catch (e) {
        return textResult(typeof e === "string" ? e : String(e), true);
      }
    },
  );
}
