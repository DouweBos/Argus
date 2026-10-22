import type {
  ToolCallInfo,
  ToolResultBlock,
} from "../../../stores/conversationStore";
import { useCallback, useMemo, type ReactNode } from "react";
import {
  Button,
  HoverActionButton,
  Icons,
  parseQuestions,
  PlanApproval,
  type PlanApprovalDraft,
  QuestionForm,
  type QuestionFormDraft,
  ToolCall,
  type ToolCallChildData,
  type ToolCallData,
  type ToolResultBlockData,
} from "@argus/peacock";
import { getAgent } from "../../../stores/agentStore";
import {
  clearToolDraft,
  getToolDraft,
  setToolDraft,
} from "../../../stores/conversationStore";
import { startNewSession } from "../../../stores/dialogStore";
import { openImageViewer } from "../../../stores/imageViewerStore";
import { getSessionState } from "../../../stores/sessionStore";
import { Markdown } from "../../shared/Markdown";
import { FileLinkHandler, LinkifiedText } from "../FileLinkHandler";
import { alwaysAllowRule } from "../alwaysAllowRule";

interface ToolCallCardProps {
  /** Agent ID — needed to route permission responses. */
  agentId?: string;
  /**
   * Fork the conversation and workspace at this tool call. Only rendered
   * (as a hover action) for file-mutating tools (Write / Edit / MultiEdit).
   */
  onFork?: () => void;
  onPermissionRespond?: (
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
    denyMessage?: string,
  ) => Promise<void> | void;
  /**
   * Save the file the tool would write to disk — entire file contents, not
   * just the diff. Only rendered for Write / Edit / MultiEdit.
   */
  onSaveToDisk?: (toolCall: ToolCallInfo) => void;
  toolCall: ToolCallInfo;
}

type ImageBlock = Extract<ToolResultBlockData, { type: "image" }>;

// --- Adapters: store ToolCallInfo → pure Peacock ToolCallData --------------

function mapResult(result: ToolCallInfo["result"]): ToolCallData["result"] {
  if (result == null || typeof result === "string") {
    return result;
  }

  return result.map(
    (block: ToolResultBlock): ToolResultBlockData =>
      block.type === "image"
        ? {
            type: "image",
            mediaType: block.source.media_type,
            data: block.source.data,
          }
        : { type: "text", text: block.text },
  );
}

function toToolCallData(tc: ToolCallInfo): ToolCallData {
  return {
    id: tc.id,
    name: tc.name,
    input: tc.input,
    isError: tc.isError,
    pendingPermission: tc.pendingPermission,
    result: mapResult(tc.result),
    children: tc.children?.map(
      (c): ToolCallChildData =>
        c.kind === "text"
          ? { kind: "text", text: c.text }
          : { kind: "tool_use", toolCall: toToolCallData(c.toolCall) },
    ),
  };
}

// Load a Read image from disk at full resolution via the argus-file://
// protocol; otherwise fall back to the base64 data URL embedded in the result.
function resolveImageSrc(
  block: ImageBlock,
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (toolName === "Read") {
    const filePath = (input.file_path ?? input.path) as string | undefined;
    if (filePath) {
      return `argus-file://local${encodeURI(filePath)}`;
    }
  }

  return block.data
    ? `data:${block.mediaType};base64,${block.data}`
    : undefined;
}

function resolveImageFallback(block: ImageBlock): string | undefined {
  return block.data
    ? `data:${block.mediaType};base64,${block.data}`
    : undefined;
}

// --- Write-tool "copy new content" helpers ---------------------------------

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

/**
 * Desktop tool-call card — the pure Peacock `ToolCall` with the desktop's
 * platform behaviour injected: `argus-file://` image resolution + native
 * viewer, file-path linkification, and the interactive permission forms.
 */
export function ToolCallCard({
  agentId,
  onFork,
  onPermissionRespond,
  onSaveToDisk,
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

  const isExitPlanMode = toolCall.name === "ExitPlanMode";
  const isAskUserQuestion = toolCall.name === "AskUserQuestion";
  const questions = isAskUserQuestion ? parseQuestions(toolCall.input) : [];
  const isPending = !!toolCall.pendingPermission;
  const allowRule = alwaysAllowRule(toolCall.name, toolCall.input);
  const planText =
    isExitPlanMode && typeof toolCall.input.plan === "string"
      ? (toolCall.input.plan as string)
      : "";

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

  // Repo the plan's session lives in — needed to seed a sibling session.
  const planRepoRoot = useMemo(() => {
    if (!isExitPlanMode || !agentId) {
      return null;
    }
    const agent = getAgent(agentId);
    if (!agent) {
      return null;
    }

    return (
      getSessionState().sessions.find((s) => s.id === agent.session_id)
        ?.repo_root ?? null
    );
  }, [isExitPlanMode, agentId]);

  // Hand the plan to a fresh session so the current one can keep planning
  // (or stay busy with another agent) instead of implementing it here.
  const handleApproveInNewSession = useCallback(() => {
    if (!planRepoRoot) {
      return;
    }
    startNewSession(
      planRepoRoot,
      `Implement the following plan:\n\n${planText}`,
    );
    onPermissionRespond?.(
      toolCall.id,
      "deny",
      undefined,
      false,
      "The user approved this plan but handed it off to a new session to implement. Do not implement it here — stay in plan mode and wait for further instructions.",
    );
  }, [planRepoRoot, planText, onPermissionRespond, toolCall.id]);

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

  const hoverActions = isWriteTool ? (
    <>
      <HoverActionButton
        icon={<Icons.CopyIcon size={12} />}
        label="Copy new content"
        onClick={handleCopyWriteContent}
      />
      {onSaveToDisk && (
        <HoverActionButton
          icon={<Icons.DownloadIcon size={12} />}
          label="Save entire file to disk"
          onClick={() => onSaveToDisk(toolCall)}
        />
      )}
      {canFork && onFork && (
        <HoverActionButton
          icon={<Icons.BranchIcon size={12} />}
          label="Fork workspace and chat from here"
          onClick={onFork}
        />
      )}
    </>
  ) : undefined;

  const questionDrafts = useMemo(
    () => ({
      get: () => getToolDraft<QuestionFormDraft>(toolCall.id),
      set: (d: QuestionFormDraft) => setToolDraft(toolCall.id, d),
      clear: () => clearToolDraft(toolCall.id),
    }),
    [toolCall.id],
  );
  const planDrafts = useMemo(
    () => ({
      get: () => getToolDraft<PlanApprovalDraft>(toolCall.id),
      set: (d: PlanApprovalDraft) => setToolDraft(toolCall.id, d),
      clear: () => clearToolDraft(toolCall.id),
    }),
    [toolCall.id],
  );
  const renderPlanMarkdown = useCallback(
    (text: string, className?: string) => (
      <Markdown className={className} text={text} />
    ),
    [],
  );

  let pendingForm: ReactNode;
  if (isPending && isExitPlanMode) {
    pendingForm = (
      <PlanApproval
        onApprove={handleAllow}
        onApproveInNewSession={
          planRepoRoot ? handleApproveInNewSession : undefined
        }
        onReject={handleRejectPlan}
        onSubmitFeedback={handlePlanFeedback}
        plan={planText}
        renderMarkdown={renderPlanMarkdown}
        drafts={planDrafts}
      />
    );
  } else if (isPending && isAskUserQuestion && questions.length > 0) {
    pendingForm = (
      <QuestionForm
        onCancel={handleCancelQuestion}
        onSubmit={handleSubmitAnswers}
        questions={questions}
        drafts={questionDrafts}
      />
    );
  }

  const showPermissionButtons =
    isPending &&
    !!agentId &&
    !isExitPlanMode &&
    !(isAskUserQuestion && questions.length > 0);

  const permissionActions = showPermissionButtons ? (
    <>
      <Button variant="primary" size="sm" onClick={handleAllow}>
        Allow
      </Button>
      <Button variant="secondary" size="sm" onClick={handleAllowAll}>
        Always Allow {allowRule}
      </Button>
      <Button variant="ghost" size="sm" onClick={handleDeny}>
        Deny
      </Button>
    </>
  ) : undefined;

  return (
    <ToolCall
      toolCall={toToolCallData(toolCall)}
      Container={FileLinkHandler}
      resolveImageSrc={resolveImageSrc}
      resolveImageFallback={resolveImageFallback}
      onImageActivate={(src, alt, fallbackSrc) =>
        openImageViewer(src, alt, src !== fallbackSrc ? fallbackSrc : undefined)
      }
      renderText={(text) => <LinkifiedText text={text} />}
      renderMarkdown={(text, className) => (
        <Markdown className={className} text={text} />
      )}
      hoverActions={hoverActions}
      pendingForm={pendingForm}
      permissionActions={permissionActions}
    />
  );
}
