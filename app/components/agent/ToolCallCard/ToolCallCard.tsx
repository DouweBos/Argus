import type {
  ToolCallInfo,
  ToolResultBlock,
} from "../../../stores/conversationStore";
import { useCallback, useState, type ReactNode } from "react";
import { Badge, Button, Icons } from "@argus/peacock";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { EditDiffView } from "../EditDiffView";
import { FileLinkHandler, LinkifiedText } from "../FileLinkHandler";
import { alwaysAllowRule } from "../alwaysAllowRule";
import { PlanApproval } from "./PlanApproval";
import { QuestionForm } from "./QuestionForm";
import styles from "./ToolCallCard.module.css";
import { parseQuestions } from "./parseQuestions";

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
    /** Optional custom message for deny (used by AskUserQuestion answers). */
    denyMessage?: string,
  ) => void;
  toolCall: ToolCallInfo;
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

/** Safely coerce a tool result to a renderable string (used for truncated previews). */
function safeResultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result == null) {
    return "";
  }
  if (Array.isArray(result)) {
    return (result as ToolResultBlock[])
      .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
      .join("\n");
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Build an image src for a tool result image block. When the tool is Read and
 * the input contains a file path, load the image directly from disk via the
 * argus-file:// protocol at full resolution. Otherwise fall back to the
 * base64 data URL embedded in the result.
 */
function imageSrc(
  block: { source: { data: string; media_type: string } },
  toolName?: string,
  toolInput?: Record<string, unknown>,
): string {
  if (toolName === "Read") {
    const filePath = (toolInput?.file_path ?? toolInput?.path) as
      | string
      | undefined;
    if (filePath) {
      return `argus-file://local${encodeURI(filePath)}`;
    }
  }

  return `data:${block.source.media_type};base64,${block.source.data}`;
}

/** Render a tool result — string as <pre>, content blocks inline (images embedded). */
function renderResult(
  result: ToolResultBlock[] | string | undefined,
  className: string,
  toolName?: string,
  toolInput?: Record<string, unknown>,
): ReactNode {
  if (typeof result === "string" || result == null) {
    return (
      <pre className={className}>
        <LinkifiedText text={result ?? ""} />
      </pre>
    );
  }

  return (
    <>
      {result.map((block, i) => {
        if (block.type === "image") {
          const src = imageSrc(block, toolName, toolInput);
          const fallback = `data:${block.source.media_type};base64,${block.source.data}`;

          return (
            <img
              alt="tool result"
              className={styles.resultImage}
              key={i}
              onClick={() =>
                openImageViewer(
                  src,
                  "tool result",
                  src !== fallback ? fallback : undefined,
                )
              }
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== fallback) {
                  img.src = fallback;
                }
              }}
              src={src}
            />
          );
        }
        if (block.type === "text") {
          return (
            <pre className={className} key={i}>
              <LinkifiedText text={block.text} />
            </pre>
          );
        }

        return (
          <pre className={className} key={i}>
            {JSON.stringify(block, null, 2)}
          </pre>
        );
      })}
    </>
  );
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
  const [userExpanded, setUserExpanded] = useState(false);
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

  const handleSubmitAnswers = useCallback(
    (formattedAnswer: string) => {
      // AskUserQuestion has no "accept" in the CLI's protocol — allowing would
      // let the CLI execute its own (piped, non-interactive) question UI.
      // We deny with a structured message that the model reads as the user's
      // response to the question.
      onPermissionRespond?.(
        toolCall.id,
        "deny",
        undefined,
        false,
        formattedAnswer,
      );
    },
    [onPermissionRespond, toolCall.id],
  );

  const handleCancelQuestion = useCallback(() => {
    onPermissionRespond?.(
      toolCall.id,
      "deny",
      undefined,
      false,
      "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them.",
    );
  }, [onPermissionRespond, toolCall.id]);

  const handleRejectPlan = useCallback(() => {
    onPermissionRespond?.(
      toolCall.id,
      "deny",
      undefined,
      false,
      "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided.",
    );
  }, [onPermissionRespond, toolCall.id]);

  const isExitPlanMode = toolCall.name === "ExitPlanMode";
  const isAskUserQuestion = toolCall.name === "AskUserQuestion";
  const planText =
    isExitPlanMode && typeof toolCall.input.plan === "string"
      ? (toolCall.input.plan as string)
      : "";
  const questions = isAskUserQuestion ? parseQuestions(toolCall.input) : [];

  let structuredInputPreview: ReactNode;
  if (isEdit) {
    structuredInputPreview = (
      <EditDiffView
        newString={toolCall.input.new_string as string}
        oldString={toolCall.input.old_string as string}
      />
    );
  } else if (isWrite) {
    structuredInputPreview = (
      <EditDiffView newString={toolCall.input.content as string} />
    );
  } else {
    structuredInputPreview = (
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Input</span>
        <pre className={`${styles.code} ${isBash ? styles.bash : ""}`}>
          <LinkifiedText text={inputText} />
        </pre>
      </div>
    );
  }

  return (
    <FileLinkHandler
      className={`${styles.card} ${toolCall.isError ? styles.cardError : ""} ${isPending ? styles.cardPending : ""}`}
    >
      <button
        aria-expanded={expanded}
        className={styles.header}
        onClick={() => setUserExpanded((v) => !v)}
      >
        <span className={styles.chevron}>
          {expanded ? (
            <Icons.ChevronDownIcon size={9} />
          ) : (
            <Icons.ChevronRightIcon size={9} />
          )}
        </span>
        <span className={styles.name}>
          {isAgent ? agentType : toolCall.name}
        </span>
        <span className={styles.summary}>
          {isAgent ? agentDesc : <LinkifiedText text={summary} />}
        </span>
        {isPending && (
          <Badge tone="warning" className={styles.pendingTag}>
            awaiting permission
          </Badge>
        )}
        {hasResult && !toolCall.isError && !isPending && (
          <Badge tone="neutral" className={styles.doneTag}>
            done
          </Badge>
        )}
        {isAgent && !hasResult && !toolCall.isError && !isPending && (
          <Badge tone="accent" className={styles.runningTag}>
            running
          </Badge>
        )}
        {toolCall.isError && <Badge tone="error">error</Badge>}
      </button>

      {expanded && (
        <div className={styles.body}>
          {isPending && isExitPlanMode && (
            <PlanApproval
              onApprove={handleAllow}
              onReject={handleRejectPlan}
              plan={planText}
            />
          )}
          {isPending && isAskUserQuestion && questions.length > 0 && (
            <QuestionForm
              onCancel={handleCancelQuestion}
              onSubmit={handleSubmitAnswers}
              questions={questions}
            />
          )}
          {!(
            isPending &&
            (isExitPlanMode || (isAskUserQuestion && questions.length > 0))
          ) &&
            (isAgent ? (
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
                      <LinkifiedText
                        text={
                          safeResultText(toolCall.result).slice(0, 500) +
                          (safeResultText(toolCall.result).length > 500
                            ? "…"
                            : "")
                        }
                      />
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <>
                {structuredInputPreview}

                {hasResult && (
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>
                      {toolCall.isError ? "Error" : "Result"}
                    </span>
                    {renderResult(
                      toolCall.result,
                      `${styles.code} ${toolCall.isError ? styles.resultError : styles.result}`,
                      toolCall.name,
                      toolCall.input,
                    )}
                  </div>
                )}
              </>
            ))}

          {isPending &&
            agentId &&
            !isExitPlanMode &&
            !(isAskUserQuestion && questions.length > 0) && (
              <div className={styles.permissionActions}>
                <Button variant="primary" size="sm" onClick={handleAllow}>
                  Allow
                </Button>
                <Button variant="secondary" size="sm" onClick={handleAllowAll}>
                  Always Allow {allowRule}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDeny}>
                  Deny
                </Button>
              </div>
            )}
        </div>
      )}
    </FileLinkHandler>
  );
}
