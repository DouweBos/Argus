import { useCallback, useMemo } from "react";
import { Badge, Button } from "@argus/peacock";
import { respondToPermission } from "../../../lib/ipc";
import { setActiveAgent, useAgentsRecord } from "../../../stores/agentStore";
import {
  clearPermission,
  useConversations,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
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

interface ToolSummary {
  detail?: string;
  label: string;
  mono?: boolean;
}

function summarize(name: string, input: Record<string, unknown>): ToolSummary {
  const path = (input.file_path ?? input.path) as string | undefined;
  switch (name) {
    case "Bash":
      return {
        label: "Bash",
        detail: (input.command ?? "") as string,
        mono: true,
      };
    case "Edit":
    case "MultiEdit":
      return { label: "Edit", detail: path, mono: true };
    case "Write":
      return { label: "Write", detail: path, mono: true };
    case "Read":
      return { label: "Read", detail: path, mono: true };
    case "Glob":
      return { label: "Glob", detail: input.pattern as string, mono: true };
    case "Grep":
      return { label: "Grep", detail: input.pattern as string, mono: true };
    case "WebFetch":
      return { label: "WebFetch", detail: input.url as string, mono: true };
    case "WebSearch":
      return { label: "WebSearch", detail: input.query as string };
    default:
      return { label: name };
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

  const reviewInChat = useCallback((entry: PendingEntry) => {
    selectWorkspace(entry.workspaceId);
    setActiveAgent(entry.workspaceId, entry.agentId);
    setActiveCenterView("agents");
  }, []);

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
        const summary = summarize(entry.toolName, entry.toolInput);
        const rule = alwaysAllowRule(entry.toolName, entry.toolInput);
        const isExitPlan = entry.toolName === "ExitPlanMode";
        const isAskQuestion = entry.toolName === "AskUserQuestion";
        const canRespondInline = !isExitPlan && !isAskQuestion;

        return (
          <div className={styles.banner} key={entry.toolUseId}>
            <div className={styles.info}>
              <div className={styles.header}>
                <span className={styles.label}>Permission needed</span>
                <button
                  className={styles.workspaceBtn}
                  onClick={() => reviewInChat(entry)}
                  title="Open this agent's chat"
                  type="button"
                >
                  <Badge tone="neutral" size="tag">
                    {entry.workspaceLabel}
                  </Badge>
                </button>
              </div>
              <div className={styles.summary}>
                <span className={styles.summaryLabel}>{summary.label}</span>
                {summary.detail && (
                  <span
                    className={`${styles.summaryDetail} ${
                      summary.mono ? styles.mono : ""
                    }`}
                    title={summary.detail}
                  >
                    {summary.detail}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.actions}>
              {canRespondInline ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => respond(entry, "deny")}
                  >
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => respond(entry, "allow", rule, true)}
                  >
                    Always {rule}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => respond(entry, "allow")}
                  >
                    Allow
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => reviewInChat(entry)}
                >
                  Review in chat
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
