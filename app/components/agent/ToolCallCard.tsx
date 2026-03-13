import { useState, useCallback } from "react";
import type { ToolCallInfo } from "../../stores/conversationStore";
import { EditDiffView } from "./EditDiffView";
import styles from "./ToolCallCard.module.css";

interface ToolCallCardProps {
  /** Agent ID — needed to route permission responses. */
  agentId?: string;
  /** Called when the user clicks Allow, Always Allow, or Deny. */
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    /** Rule string like `Bash(npm *)` or `Edit(**\/*.tsx)` for "always allow". */
    allowRule?: string,
    allowAll?: boolean,
  ) => void;
  toolCall: ToolCallInfo;
}

/**
 * Generate a Claude CLI-style rule specifier for the "Always Allow" button.
 *
 * Examples:
 *   Bash(npm *)     — allow all `npm` subcommands
 *   Edit(**\/*.tsx)   — allow edits to all .tsx files
 *   WebFetch(domain:example.com)
 *   Grep            — allow all Grep calls (no meaningful specifier)
 */
export function alwaysAllowRule(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash": {
      const cmd = ((input.command ?? "") as string).trim();
      const binary = cmd.split(/\s+/)[0] ?? "";
      return binary ? `${name}(${binary} *)` : name;
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read": {
      const filePath = (input.file_path ?? input.path ?? "") as string;
      const ext = filePath.split(".").pop();
      if (ext && ext !== filePath && !ext.includes("/")) {
        return `${name}(**/*.${ext})`;
      }
      return name;
    }
    case "WebFetch": {
      const url = (input.url ?? "") as string;
      try {
        const domain = new URL(url).hostname;
        return domain ? `${name}(domain:${domain})` : name;
      } catch {
        return name;
      }
    }
    default:
      return name;
  }
}

/** Generate a short human-readable summary from tool name + input. */
function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Edit":
    case "MultiEdit": {
      const path = (input.file_path ?? input.path ?? "") as string;
      return `Edit ${path}`;
    }
    case "Write": {
      const path = (input.file_path ?? input.path ?? "") as string;
      return `Write ${path}`;
    }
    case "Read": {
      const path = (input.file_path ?? input.path ?? "") as string;
      return `Read ${path}`;
    }
    case "Bash": {
      const cmd = ((input.command ?? "") as string).slice(0, 60);
      return `Bash: ${cmd}`;
    }
    case "Glob": {
      const pattern = (input.pattern ?? "") as string;
      return `Glob: ${pattern}`;
    }
    case "Grep": {
      const pattern = (input.pattern ?? "") as string;
      return `Grep: ${pattern}`;
    }
    case "LS": {
      const path = (input.path ?? ".") as string;
      return `LS ${path}`;
    }
    case "Task": {
      const desc = (input.description ?? "") as string;
      return `Task: ${desc.slice(0, 60)}`;
    }
    case "WebSearch": {
      const query = (input.query ?? "") as string;
      return `WebSearch: ${query.slice(0, 60)}`;
    }
    case "WebFetch": {
      const url = (input.url ?? "") as string;
      return `WebFetch: ${url.slice(0, 60)}`;
    }
    case "Agent": {
      const type = (input.subagent_type ?? "") as string;
      const desc = (input.description ?? "") as string;
      const label = type || "Agent";
      return desc ? `${label}: ${desc.slice(0, 80)}` : label;
    }
    default:
      return name;
  }
}

/** Safely coerce a tool result to a renderable string. */
function safeResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result == null) return "";
  return JSON.stringify(result, null, 2);
}

/** Format input params for display. Bash commands get plain text, others get JSON. */
function formatInput(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && input.command) {
    return input.command as string;
  }
  return JSON.stringify(input, null, 2);
}

export function ToolCallCard({
  agentId,
  onPermissionRespond,
  toolCall,
}: ToolCallCardProps) {
  const [userExpanded, setExpanded] = useState(false);
  // Auto-expand when a permission request is pending; user toggle applies otherwise.
  const expanded = !!toolCall.pendingPermission || userExpanded;

  const isAgent = toolCall.name === "Agent";
  const agentType = isAgent
    ? ((toolCall.input.subagent_type ?? "") as string) || "Agent"
    : "";
  const agentDesc = isAgent
    ? ((toolCall.input.description ?? "") as string)
    : "";
  const summary = toolSummary(toolCall.name, toolCall.input);
  const hasResult = toolCall.result !== undefined;
  const isBash = toolCall.name === "Bash";
  const isEdit =
    (toolCall.name === "Edit" || toolCall.name === "MultiEdit") &&
    typeof toolCall.input.old_string === "string" &&
    typeof toolCall.input.new_string === "string";
  const isWrite =
    toolCall.name === "Write" && typeof toolCall.input.content === "string";
  const inputText = formatInput(toolCall.name, toolCall.input);
  const isPending = toolCall.pendingPermission;
  const allowRule = alwaysAllowRule(toolCall.name, toolCall.input);

  const handleAllow = useCallback(() => {
    onPermissionRespond?.(toolCall.id, "allow");
  }, [onPermissionRespond, toolCall.id]);

  const handleAllowAll = useCallback(() => {
    onPermissionRespond?.(toolCall.id, "allow", allowRule, true);
  }, [onPermissionRespond, toolCall.id, allowRule]);

  const handleDeny = useCallback(() => {
    onPermissionRespond?.(toolCall.id, "deny");
  }, [onPermissionRespond, toolCall.id]);

  return (
    <div
      className={`${styles.card} ${toolCall.isError ? styles.cardError : ""} ${isPending ? styles.cardPending : ""}`}
    >
      <button
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron}>{expanded ? "▾" : "▸"}</span>
        <span className={styles.name}>
          {isAgent ? agentType : toolCall.name}
        </span>
        <span className={styles.summary}>{isAgent ? agentDesc : summary}</span>
        {isPending && (
          <span className={styles.pendingTag}>awaiting permission</span>
        )}
        {hasResult && !toolCall.isError && !isPending && (
          <span className={styles.doneTag}>done</span>
        )}
        {isAgent && !hasResult && !toolCall.isError && !isPending && (
          <span className={styles.runningTag}>running</span>
        )}
        {toolCall.isError && <span className={styles.errorTag}>error</span>}
      </button>

      {expanded && (
        <div className={styles.body}>
          {isAgent ? (
            <>
              {agentDesc && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Description</span>
                  <pre className={styles.code}>{agentDesc}</pre>
                </div>
              )}
              {hasResult && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>
                    {toolCall.isError ? "Error" : "Result"}
                  </span>
                  <pre
                    className={`${styles.code} ${toolCall.isError ? styles.resultError : styles.result}`}
                  >
                    {safeResultText(toolCall.result).slice(0, 500)}
                    {safeResultText(toolCall.result).length > 500 ? "…" : ""}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <>
              {isEdit ? (
                <EditDiffView
                  oldString={toolCall.input.old_string as string}
                  newString={toolCall.input.new_string as string}
                />
              ) : isWrite ? (
                <EditDiffView newString={toolCall.input.content as string} />
              ) : (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Input</span>
                  <pre
                    className={`${styles.code} ${isBash ? styles.bash : ""}`}
                  >
                    {inputText}
                  </pre>
                </div>
              )}

              {hasResult && (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>
                    {toolCall.isError ? "Error" : "Result"}
                  </span>
                  <pre
                    className={`${styles.code} ${toolCall.isError ? styles.resultError : styles.result}`}
                  >
                    {safeResultText(toolCall.result)}
                  </pre>
                </div>
              )}
            </>
          )}

          {isPending && agentId && (
            <div className={styles.permissionActions}>
              <button className={styles.allowBtn} onClick={handleAllow}>
                Allow
              </button>
              <button className={styles.allowAllBtn} onClick={handleAllowAll}>
                Always Allow {allowRule}
              </button>
              <button className={styles.denyBtn} onClick={handleDeny}>
                Deny
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
