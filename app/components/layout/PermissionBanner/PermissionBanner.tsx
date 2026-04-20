import { useCallback, useMemo } from "react";
import { Badge, Button } from "@argus/peacock";
import { respondToPermission } from "../../../lib/ipc";
import { formatToolName } from "../../../lib/toolLabels";
import { setActiveAgent, useAgentsRecord } from "../../../stores/agentStore";
import {
  clearPermission,
  useConversations,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { alwaysAllowRule } from "../../agent/alwaysAllowRule";
import styles from "./PermissionBanner.module.css";

interface PendingEntry {
  agentId: string;
  sessionId: string;
  sessionLabel: string;
  toolInput: Record<string, unknown>;
  toolName: string;
  toolUseId: string;
}

interface ToolSummary {
  detail?: string;
  label: string;
  mono?: boolean;
}

function summarize(name: string, input: Record<string, unknown>): ToolSummary {
  const path = (input.file_path ?? input.path) as string | undefined;
  const label = formatToolName(name);
  switch (name) {
    case "Bash":
      return {
        label,
        detail: (input.command ?? "") as string,
        mono: true,
      };
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read":
      return { label, detail: path, mono: true };
    case "Glob":
    case "Grep":
      return { label, detail: input.pattern as string, mono: true };
    case "WebFetch":
      return { label, detail: input.url as string, mono: true };
    case "WebSearch":
      return { label, detail: input.query as string };
    default:
      return { label };
  }
}

export function PermissionBanner() {
  const conversations = useConversations();
  const agents = useAgentsRecord();
  const sessions = useSessions();

  const pending = useMemo<PendingEntry[]>(() => {
    const entries: PendingEntry[] = [];
    for (const [agentId, conv] of Object.entries(conversations)) {
      const agent = agents[agentId];
      if (!agent) {
        continue;
      }
      const session = sessions.find((w) => w.id === agent.session_id);
      const sessionLabel =
        session?.display_name || session?.branch || agent.session_id;

      for (const msg of conv.messages) {
        if (msg.role !== "assistant") {
          continue;
        }
        for (const tc of msg.toolCalls) {
          if (tc.pendingPermission) {
            entries.push({
              agentId,
              sessionId: agent.session_id,
              sessionLabel,
              toolUseId: tc.id,
              toolName: tc.name,
              toolInput: tc.input,
            });
          }
        }
      }
    }

    return entries;
  }, [conversations, agents, sessions]);

  const reviewInChat = useCallback((entry: PendingEntry) => {
    selectSession(entry.sessionId);
    setActiveAgent(entry.sessionId, entry.agentId);
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
                  className={styles.sessionBtn}
                  onClick={() => reviewInChat(entry)}
                  title="Open this agent's chat"
                  type="button"
                >
                  <Badge tone="neutral" size="tag">
                    {entry.sessionLabel}
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
