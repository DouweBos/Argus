import { useCallback, useMemo } from "react";
import { respondToPermission } from "../../../lib/ipc";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  clearPermission,
  useConversations,
} from "../../../stores/conversationStore";
import { selectWorkspace, useWorkspaces } from "../../../stores/workspaceStore";
import { alwaysAllowRule } from "../../agent/alwaysAllowRule";
import styles from "./PermissionBanner.module.css";

interface PendingEntry {
  agentId: string;
  toolInput: Record<string, unknown>;
  toolName: string;
  toolUseId: string;
  workspaceId: string;
  workspaceLabel: string;
}

function shortSummary(name: string, input: Record<string, unknown>): string {
  const path = (input.file_path ?? input.path) as string | undefined;
  switch (name) {
    case "Bash":
      return `Bash: ${((input.command ?? "") as string).slice(0, 80)}`;
    case "Edit":
    case "MultiEdit":
      return path ? `Edit ${path}` : "Edit";
    case "Write":
      return path ? `Write ${path}` : "Write";
    case "Read":
      return path ? `Read ${path}` : "Read";
    case "Glob":
      return `Glob: ${(input.pattern ?? "") as string}`;
    case "Grep":
      return `Grep: ${(input.pattern ?? "") as string}`;
    case "WebFetch":
      return `WebFetch: ${((input.url ?? "") as string).slice(0, 80)}`;
    case "WebSearch":
      return `WebSearch: ${((input.query ?? "") as string).slice(0, 80)}`;
    default:
      return name;
  }
}

export function PermissionBanner() {
  const conversations = useConversations();
  const agents = useAgentsRecord();
  const workspaces = useWorkspaces();

  const pending = useMemo<PendingEntry[]>(() => {
    const entries: PendingEntry[] = [];
    for (const [agentId, conv] of Object.entries(conversations)) {
      const agent = agents[agentId];
      if (!agent) {
        continue;
      }
      const workspace = workspaces.find((w) => w.id === agent.workspace_id);
      const workspaceLabel =
        workspace?.display_name || workspace?.branch || agent.workspace_id;

      for (const msg of conv.messages) {
        if (msg.role !== "assistant") {
          continue;
        }
        for (const tc of msg.toolCalls) {
          if (tc.pendingPermission) {
            entries.push({
              agentId,
              workspaceId: agent.workspace_id,
              workspaceLabel,
              toolUseId: tc.id,
              toolName: tc.name,
              toolInput: tc.input,
            });
          }
        }
      }
    }

    return entries;
  }, [conversations, agents, workspaces]);

  const respond = useCallback(
    async (
      entry: PendingEntry,
      decision: "allow" | "deny",
      allowRule?: string,
      allowAll?: boolean,
    ) => {
      clearPermission(entry.agentId, entry.toolUseId);
      try {
        await respondToPermission(
          entry.agentId,
          entry.toolUseId,
          decision,
          allowRule,
          allowAll,
        );
      } catch {
        // Best-effort — the request may have already been withdrawn.
      }
    },
    [],
  );

  if (pending.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {pending.map((entry) => {
        const summary = shortSummary(entry.toolName, entry.toolInput);
        const rule = alwaysAllowRule(entry.toolName, entry.toolInput);
        const isExitPlan = entry.toolName === "ExitPlanMode";
        const isAskQuestion = entry.toolName === "AskUserQuestion";
        const canRespondInline = !isExitPlan && !isAskQuestion;

        return (
          <div className={styles.banner} key={entry.toolUseId}>
            <div className={styles.info}>
              <div className={styles.label}>
                <span>Permission needed</span>
                <button
                  className={styles.workspace}
                  onClick={() => selectWorkspace(entry.workspaceId)}
                  title="Open this agent's chat"
                  type="button"
                >
                  {entry.workspaceLabel}
                </button>
              </div>
              <div className={styles.summary}>{summary}</div>
            </div>
            <div className={styles.actions}>
              {canRespondInline ? (
                <>
                  <button
                    className={`${styles.btn} ${styles.allow}`}
                    onClick={() => respond(entry, "allow")}
                    type="button"
                  >
                    Allow
                  </button>
                  <button
                    className={`${styles.btn} ${styles.allowAll}`}
                    onClick={() => respond(entry, "allow", rule, true)}
                    type="button"
                  >
                    Always {rule}
                  </button>
                  <button
                    className={`${styles.btn} ${styles.deny}`}
                    onClick={() => respond(entry, "deny")}
                    type="button"
                  >
                    Deny
                  </button>
                </>
              ) : (
                <button
                  className={`${styles.btn} ${styles.allow}`}
                  onClick={() => selectWorkspace(entry.workspaceId)}
                  type="button"
                >
                  Review in chat
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
