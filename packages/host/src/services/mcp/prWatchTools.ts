/**
 * `watch_pull_request`: an agent that opened a PR hands the waiting to the
 * host and gets woken with what changed, instead of polling CI itself.
 */

import type { Session } from "../session/models";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appState } from "../../state";
import { POLL_MS } from "../github/prWatch/watched";

type ResolveSession = (
  idOrBranch: string,
  projectPath: string,
  callerAgentId: string | null,
) => Promise<Session | null>;

function text(body: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: body }],
    ...(isError ? { isError: true } : {}),
  };
}

export function registerPrWatchTools(
  server: McpServer,
  callerAgentId: string | null,
  resolveSession: ResolveSession,
): void {
  server.tool(
    "watch_pull_request",
    `Watch your session's open pull request (GitHub) or merge request (GitLab) after you push it, instead of polling CI yourself. Argus checks it every ${POLL_MS / 60_000} minutes and sends you a message when a check fails (with its annotations and the end of the failing log or job trace), when the checks that gate the merge all pass, when the branch conflicts with its base, or when someone comments or reviews. End your turn after calling this; the message arrives as your next prompt. Watching stops by itself when the PR merges or closes. Pass stop: true to stop earlier.`,
    {
      session: z
        .string()
        .optional()
        .describe(
          "Session ID or branch name whose PR to watch. Defaults to your own session.",
        ),
      project_path: z
        .string()
        .optional()
        .describe(
          "Project the session belongs to. Only needed with `session`; use the project_path from your system prompt.",
        ),
      stop: z
        .boolean()
        .optional()
        .describe("Stop watching instead of starting."),
    },
    async ({ session, project_path, stop }) => {
      const own = callerAgentId
        ? appState.agents.get(callerAgentId)?.sessionId
        : undefined;
      let target: Session | null | undefined;
      if (session) {
        const root =
          project_path ??
          (own ? appState.sessions.get(own)?.repo_root : undefined);
        target = root
          ? await resolveSession(session, root, callerAgentId)
          : null;
      } else {
        target = own ? appState.sessions.get(own) : undefined;
      }
      if (!target) {
        return text(
          session
            ? `Session not found: ${session}`
            : "No session to watch — pass `session` and `project_path`.",
          true,
        );
      }

      // Loaded on use: the watcher wakes agents through the conversation stack.
      const { unwatchPullRequest, watchPullRequest } =
        await import("../github/prWatch/watcher");
      if (stop) {
        return text(
          unwatchPullRequest(target.id, "mcp")
            ? "Stopped watching the pull request."
            : "The pull request was not being watched.",
        );
      }

      try {
        const status = await watchPullRequest(target.id, {
          agentId: callerAgentId,
          via: "mcp",
        });
        const { failing, passing, pending } = status.checks;
        const lines = [
          `Watching PR #${status.pr_number} (${status.pr_url}).`,
          `Checks now: ${passing} passing, ${pending} pending, ${failing.length} failing${failing.length ? ` (${failing.join(", ")})` : ""}.`,
        ];
        if (failing.length > 0 || status.mergeable === "CONFLICTING") {
          lines.push(
            "Details on what is already broken follow as your next message.",
          );
        } else if (status.green) {
          lines.push(
            "Everything that gates the merge is green; you will hear about new comments, conflicts or failures.",
          );
        }
        lines.push(
          "End your turn now — you will be messaged when something changes.",
        );

        return text(lines.join("\n"));
      } catch (e) {
        return text(String(e), true);
      }
    },
  );
}
