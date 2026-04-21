import type {
  ToolCallInfo,
  ToolResultBlock,
} from "../../../stores/conversationStore";
import { useCallback, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  HoverActionBar,
  HoverActionButton,
  Icons,
} from "@argus/peacock";
import { renderMarkdown } from "../../../lib/markdown";
import { updateAgent } from "../../../stores/agentStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { EditDiffView } from "../EditDiffView";
import { FileLinkHandler, LinkifiedText } from "../FileLinkHandler";
import { alwaysAllowRule } from "../alwaysAllowRule";
import { AnsweredQuestionView } from "./AnsweredQuestionView";
import { PlanApproval } from "./PlanApproval";
import { QuestionForm } from "./QuestionForm";
import styles from "./ToolCallCard.module.css";
import { parseAnswerSelections } from "./parseAnswerSelections";
import { parseQuestions } from "./parseQuestions";

interface ToolCallCardProps {
  /** Agent ID — needed to route permission responses. */
  agentId?: string;
  /**
   * Fork the conversation and workspace at this tool call. Only rendered
   * (as a hover action) for file-mutating tools (Write / Edit / MultiEdit).
   */
  onFork?: () => void;
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
    case "MultiEdit":
    case "Write":
    case "Read": {
      return (input.file_path ?? input.path ?? "") as string;
    }

    case "Bash": {
      return ((input.command ?? "") as string).slice(0, 60);
    }

    case "Glob":
    case "Grep": {
      return (input.pattern ?? "") as string;
    }

    case "LS": {
      return (input.path ?? ".") as string;
    }

    case "Task": {
      return ((input.description ?? "") as string).slice(0, 60);
    }

    case "WebSearch": {
      return ((input.query ?? "") as string).slice(0, 60);
    }

    case "WebFetch": {
      return ((input.url ?? "") as string).slice(0, 60);
    }

    case "Agent": {
      const type = (input.subagent_type ?? "") as string;
      const desc = (input.description ?? "") as string;
      const label = type || "Agent";

      return desc ? `${label}: ${desc.slice(0, 80)}` : label;
    }

    default:
      return "";
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

/** Count additions/deletions for an Edit — mirrors EditDiffView's prefix/suffix logic. */
function computeEditStats(
  oldStr: string,
  newStr: string,
): { additions: number; deletions: number } {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  return {
    additions: newLines.length - prefixLen - suffixLen,
    deletions: oldLines.length - prefixLen - suffixLen,
  };
}

/** Format input params for display. Bash commands get plain text, others get JSON. */
function formatInput(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && input.command) {
    return input.command as string;
  }

  return JSON.stringify(input, null, 2);
}

function WriteToolActions({
  onCopy,
  onFork,
}: {
  onCopy: () => void;
  onFork?: () => void;
}) {
  return (
    <HoverActionBar className={styles.forkActions} placement="top-right">
      <HoverActionButton
        icon={<Icons.CopyIcon size={12} />}
        label="Copy new content"
        onClick={onCopy}
      />
      {onFork && (
        <HoverActionButton
          icon={<Icons.BranchIcon size={12} />}
          label="Fork workspace and chat from here"
          onClick={onFork}
        />
      )}
    </HoverActionBar>
  );
}

/**
 * Return only the added lines (not the common prefix/suffix context) when
 * diffing `oldStr` against `newStr`, mirroring EditDiffView's diff logic.
 */
function addedLines(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  return newLines.slice(prefixLen, newLines.length - suffixLen).join("\n");
}

/**
 * Extract just the added lines from a Write / Edit / MultiEdit tool call,
 * suitable for placing on the clipboard. Context lines present in both old
 * and new are excluded.
 */
function writeToolAddedContent(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "Write" && typeof input.content === "string") {
    return input.content;
  }
  if (
    name === "Edit" &&
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return addedLines(input.old_string, input.new_string);
  }
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return (input.edits as Record<string, unknown>[])
      .map((e) =>
        typeof e.old_string === "string" && typeof e.new_string === "string"
          ? addedLines(e.old_string, e.new_string)
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export function ToolCallCard({
  agentId,
  onFork,
  onPermissionRespond,
  toolCall,
}: ToolCallCardProps) {
  const isWriteTool =
    toolCall.name === "Write" ||
    toolCall.name === "Edit" ||
    toolCall.name === "MultiEdit";
  const canFork = onFork != null && isWriteTool;

  const handleCopyWriteContent = useCallback(() => {
    const text = writeToolAddedContent(toolCall.name, toolCall.input);
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [toolCall.name, toolCall.input]);
  const [userExpanded, setUserExpanded] = useState(false);
  // Auto-expand when a permission request is pending; user toggle applies otherwise.
  const expanded = !!toolCall.pendingPermission || userExpanded;

  const isAgent = toolCall.name === "Agent";
  const isSubAgentParent =
    toolCall.name === "Agent" || toolCall.name === "Task";
  const children = toolCall.children ?? [];
  const childToolCalls = children.flatMap((c) =>
    c.kind === "tool_use" ? [c.toolCall] : [],
  );
  const previewToolCalls = childToolCalls.slice(-5);
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
  const isAskUserQuestion = toolCall.name === "AskUserQuestion";
  const questions = isAskUserQuestion ? parseQuestions(toolCall.input) : [];
  const isAnsweredQuestion =
    isAskUserQuestion &&
    questions.length > 0 &&
    hasResult &&
    !toolCall.pendingPermission;
  const answeredSelections = isAnsweredQuestion
    ? parseAnswerSelections(questions, safeResultText(toolCall.result))
    : [];
  // Edit/Write diffs and answered questions are always visible so the user sees
  // the content without a click. The chevron only hides the result payload.
  const alwaysShowInputPreview = isEdit || isWrite || isAnsweredQuestion;
  const inputText = formatInput(toolCall.name, toolCall.input);
  let editStats: { additions: number; deletions: number } | null = null;
  if (isEdit) {
    editStats = computeEditStats(
      toolCall.input.old_string as string,
      toolCall.input.new_string as string,
    );
  } else if (isWrite) {
    const content = toolCall.input.content as string;
    editStats = {
      additions: content === "" ? 0 : content.split("\n").length,
      deletions: 0,
    };
  }
  const isPending = toolCall.pendingPermission;
  const allowRule = alwaysAllowRule(toolCall.name, toolCall.input);

  const handleAllow = useCallback(() => {
    // Approving ExitPlanMode causes the CLI to leave plan mode internally,
    // but it doesn't notify us. Clear our local flag so the chip reflects
    // reality — otherwise the user toggles it manually mid-implementation,
    // which sends a `set_permission_mode` control request that interrupts
    // the in-flight turn.
    if (toolCall.name === "ExitPlanMode" && agentId) {
      updateAgent(agentId, { permission_mode: undefined });
    }
    onPermissionRespond?.(toolCall.id, "allow");
  }, [agentId, onPermissionRespond, toolCall.id, toolCall.name]);

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

  const handlePlanFeedback = useCallback(
    (feedback: string) => {
      onPermissionRespond?.(
        toolCall.id,
        "deny",
        undefined,
        false,
        `The user wants to refine the plan before approving it. Their feedback:\n\n${feedback}\n\nIncorporate this feedback and propose an updated plan via ExitPlanMode.`,
      );
    },
    [onPermissionRespond, toolCall.id],
  );

  const isExitPlanMode = toolCall.name === "ExitPlanMode";
  const planText =
    isExitPlanMode && typeof toolCall.input.plan === "string"
      ? (toolCall.input.plan as string)
      : "";

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
  } else if (isAnsweredQuestion) {
    structuredInputPreview = (
      <AnsweredQuestionView
        questions={questions}
        selections={answeredSelections}
      />
    );
  } else if (isExitPlanMode && planText) {
    structuredInputPreview = (
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Plan</span>
        <div
          className={styles.planPreview}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(planText) }}
        />
      </div>
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
      {isWriteTool && (
        <WriteToolActions
          onCopy={handleCopyWriteContent}
          onFork={canFork ? onFork : undefined}
        />
      )}
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
        {editStats && (editStats.additions > 0 || editStats.deletions > 0) && (
          <span className={styles.editStats}>
            {editStats.additions > 0 && (
              <span className={styles.statsAdd}>+{editStats.additions}</span>
            )}
            {editStats.deletions > 0 && (
              <span className={styles.statsDel}>-{editStats.deletions}</span>
            )}
          </span>
        )}
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

      {alwaysShowInputPreview && !expanded && (
        <div className={styles.body}>{structuredInputPreview}</div>
      )}

      {isSubAgentParent && !expanded && previewToolCalls.length > 0 && (
        <div className={styles.inlinePreview}>
          {previewToolCalls.map((child) => {
            const childSummary = toolSummary(child.name, child.input);
            const childLabel =
              child.name === "Agent"
                ? ((child.input.subagent_type ?? "") as string) || "Agent"
                : child.name;

            return (
              <div className={styles.previewRow} key={child.id}>
                <span className={styles.previewName}>{childLabel}</span>
                {childSummary && (
                  <span className={styles.previewSummary}>{childSummary}</span>
                )}
              </div>
            );
          })}
          {childToolCalls.length > previewToolCalls.length && (
            <div className={styles.previewMore}>
              +{childToolCalls.length - previewToolCalls.length} more
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className={styles.body}>
          {isPending && isExitPlanMode && (
            <PlanApproval
              onApprove={handleAllow}
              onReject={handleRejectPlan}
              onSubmitFeedback={handlePlanFeedback}
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

                {hasResult && !isAnsweredQuestion && (
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

          {isSubAgentParent && children.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Sub-agent activity</span>
              <div className={styles.children}>
                {children.map((child, i) =>
                  child.kind === "text" ? (
                    <div className={styles.childText} key={i}>
                      <LinkifiedText text={child.text} />
                    </div>
                  ) : (
                    <ToolCallCard
                      agentId={agentId}
                      key={child.toolCall.id}
                      toolCall={child.toolCall}
                    />
                  ),
                )}
              </div>
            </div>
          )}

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
