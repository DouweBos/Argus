/**
 * `set_session_status`: an agent says where its session's work stands, so the
 * sidebar shows it without the user opening the chat.
 */

import type { Session } from "../session/models";
import { SessionWorkflowStatus } from "@argus/remote-protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appState } from "../../state";
import { setSessionStatus } from "../session/triage";

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

const LABELS: Record<SessionWorkflowStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export function registerSessionStatusTools(
  server: McpServer,
  callerAgentId: string | null,
  resolveSession: ResolveSession,
): void {
  server.tool(
    "set_session_status",
    'Set your session\'s workflow status, shown next to it in the user\'s session list: `todo`, `in_progress`, `in_review` (e.g. a pull request is up), or `done` (folds it away under Done). Add a one-line `note` on where it stands, e.g. "waiting on CI" or "needs a design decision". Set it when the state of the work really changes, not on every step. Pass `status: null` to go back to following the session\'s pull request.',
    {
      status: SessionWorkflowStatus.nullable().describe(
        "todo, in_progress, in_review or done; null follows the pull request.",
      ),
      note: z
        .string()
        .max(500)
        .nullable()
        .optional()
        .describe(
          "One short line on where it stands. Omit to keep the current note; null or empty clears it.",
        ),
      session: z
        .string()
        .optional()
        .describe(
          "Session ID or branch name. Defaults to your own session; only set it for another session.",
        ),
      project_path: z
        .string()
        .optional()
        .describe(
          "Project the session belongs to. Only needed with `session`; use the project_path from your system prompt.",
        ),
    },
    async ({ status, note, session, project_path }) => {
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
            : "No session of yours to set — pass `session` and `project_path`.",
          true,
        );
      }
      if (target.kind !== "worktree" && target.kind !== "scratch_pad") {
        return text(
          "Only a worktree session or a scratch pad has a status.",
          true,
        );
      }

      try {
        setSessionStatus(target.id, status, note, "agent");
      } catch (e) {
        return text(String(e), true);
      }

      return text(
        status
          ? `Status set to ${LABELS[status]}.`
          : "Status cleared; it follows the pull request again.",
      );
    },
  );
}
