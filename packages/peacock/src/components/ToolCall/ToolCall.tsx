import {
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  useState,
} from "react";
import * as Icons from "../../icons/Icons";
import { AnsweredQuestion } from "../AnsweredQuestion/AnsweredQuestion";
import { Badge } from "../Badge/Badge";
import { DiffView, computeDiffStats } from "../DiffView/DiffView";
import {
  HoverActionBar,
  HoverActionButton,
} from "../HoverActionBar/HoverActionBar";
import { Markdown } from "../Markdown/Markdown";
import { ToolResultImage } from "../ToolResultImage/ToolResultImage";
import styles from "./ToolCall.module.css";
import {
  type ToolCallData,
  type ToolResultBlockData,
  formatInput,
  isPathTool,
  safeResultText,
  toolSummary,
} from "./helpers";
import { parseAnswerSelections, parseQuestions } from "./questions";

type ImageBlock = Extract<ToolResultBlockData, { type: "image" }>;

export interface ToolCallProps {
  toolCall: ToolCallData;
  /** Resolve an image block to a displayable src (argus-file:// or data URL). */
  resolveImageSrc: (
    block: ImageBlock,
    toolName: string,
    input: Record<string, unknown>,
  ) => string | undefined;
  /** Optional base64 fallback if the primary src fails to load. */
  resolveImageFallback?: (
    block: ImageBlock,
    toolName: string,
    input: Record<string, unknown>,
  ) => string | undefined;
  /** Open an image full-screen (desktop native viewer). Omit → Peacock lightbox. */
  onImageActivate?: (src: string, alt: string, fallbackSrc?: string) => void;
  onImageContextMenu?: (
    e: MouseEvent<HTMLImageElement>,
    block: ImageBlock,
    src: string,
  ) => void;
  /** Render plain text (linkified on desktop). Default: raw string. */
  renderText?: (text: string) => ReactNode;
  /** Render markdown (plan preview). Default: Peacock Markdown. */
  renderMarkdown?: (text: string, className?: string) => ReactNode;
  /** Hover action buttons in the top-right (copy new content / save / fork). */
  hoverActions?: ReactNode;
  /** Replaces the body while pending — PlanApproval / QuestionForm (desktop). */
  pendingForm?: ReactNode;
  /** Appended when pending — Allow/Deny buttons. undefined ⇒ read-only. */
  permissionActions?: ReactNode;
  /** Outer element (link-click delegation on desktop). Default: plain div. */
  Container?: ComponentType<{ className?: string; children: ReactNode }>;
}

const DefaultContainer: ComponentType<{
  className?: string;
  children: ReactNode;
}> = ({ className, children }) => <div className={className}>{children}</div>;

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

/**
 * The presentational tool-call card — header, collapsible input/result,
 * per-tool layout dispatch (Edit→diff, Read→content+images, Bash→command,
 * Agent/Task→children, AskUserQuestion→answered, ExitPlanMode→plan), and
 * nested sub-agent activity. All platform behaviour is injected via props;
 * omitting the permission slots yields a read-only card.
 */
export function ToolCall(props: ToolCallProps) {
  const {
    toolCall,
    hoverActions,
    pendingForm,
    permissionActions,
    Container = DefaultContainer,
  } = props;
  const renderText = props.renderText ?? ((t: string) => t);
  const renderMarkdown =
    props.renderMarkdown ??
    ((text: string, className?: string) => (
      <Markdown className={className} text={text} />
    ));

  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = !!toolCall.pendingPermission || userExpanded;

  const isAgent = toolCall.name === "Agent";
  const isSubAgentParent = isAgent || toolCall.name === "Task";
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
  const isPathSummary = isPathTool(toolCall.name);
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
  const alwaysShowInputPreview = isEdit || isWrite || isAnsweredQuestion;
  const inputText = formatInput(toolCall.name, toolCall.input);

  let editStats: { additions: number; deletions: number } | null = null;
  if (isEdit) {
    editStats = computeDiffStats(
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
  const isExitPlanMode = toolCall.name === "ExitPlanMode";
  const planText =
    isExitPlanMode && typeof toolCall.input.plan === "string"
      ? (toolCall.input.plan as string)
      : "";

  const renderResult = (className: string): ReactNode => {
    const result = toolCall.result;
    if (typeof result === "string" || result == null) {
      return <pre className={className}>{renderText(result ?? "")}</pre>;
    }

    return result.map((block, i) => {
      if (block.type === "image") {
        const src = props.resolveImageSrc(block, toolCall.name, toolCall.input);
        const fallback = props.resolveImageFallback?.(
          block,
          toolCall.name,
          toolCall.input,
        );
        if (!src) {
          return null;
        }

        return (
          <ToolResultImage
            key={i}
            src={src}
            fallbackSrc={fallback}
            onActivate={
              props.onImageActivate
                ? (s) => props.onImageActivate?.(s, "tool result", fallback)
                : undefined
            }
            onContextMenu={
              props.onImageContextMenu
                ? (e) => props.onImageContextMenu?.(e, block, src)
                : undefined
            }
          />
        );
      }

      return (
        <pre className={className} key={i}>
          {renderText(block.text)}
        </pre>
      );
    });
  };

  let structuredInputPreview: ReactNode;
  if (isEdit) {
    structuredInputPreview = (
      <DiffView
        newString={toolCall.input.new_string as string}
        oldString={toolCall.input.old_string as string}
      />
    );
  } else if (isWrite) {
    structuredInputPreview = (
      <DiffView newString={toolCall.input.content as string} />
    );
  } else if (isAnsweredQuestion) {
    structuredInputPreview = (
      <div className={styles.answeredWrap}>
        {questions.map((q, qi) => {
          const parsed = answeredSelections[qi] ?? {
            picks: new Set<string>(),
            note: "",
          };
          const answers = q.options
            .filter((opt) => parsed.picks.has(opt.label))
            .map((opt) => ({ label: opt.label, description: opt.description }));

          return (
            <AnsweredQuestion
              answers={answers}
              header={q.header ?? q.question}
              key={qi}
              note={parsed.note}
            />
          );
        })}
      </div>
    );
  } else if (isExitPlanMode && planText) {
    structuredInputPreview = (
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Plan</span>
        {renderMarkdown(planText, styles.planPreview)}
      </div>
    );
  } else {
    structuredInputPreview = (
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Input</span>
        <HoverActionBar className={styles.sectionActions} placement="top-right">
          <HoverActionButton
            icon={<Icons.CopyIcon size={12} />}
            label="Copy input"
            onClick={() => copy(inputText)}
          />
        </HoverActionBar>
        <pre className={`${styles.code} ${isBash ? styles.bash : ""}`}>
          {renderText(inputText)}
        </pre>
      </div>
    );
  }

  return (
    <Container
      className={`${styles.card} ${toolCall.isError ? styles.cardError : ""} ${
        isPending ? styles.cardPending : ""
      }`}
    >
      {hoverActions && (
        <HoverActionBar className={styles.hoverActions} placement="top-right">
          {hoverActions}
        </HoverActionBar>
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
        <span
          className={`${styles.summary} ${isPathSummary ? styles.summaryPath : ""}`}
        >
          {isAgent ? agentDesc : renderText(summary)}
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
                  <span
                    className={`${styles.previewSummary} ${
                      isPathTool(child.name) ? styles.summaryPath : ""
                    }`}
                  >
                    {childSummary}
                  </span>
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
          {isPending && pendingForm}
          {!(isPending && pendingForm) &&
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
                    <HoverActionBar
                      className={styles.sectionActions}
                      placement="top-right"
                    >
                      <HoverActionButton
                        icon={<Icons.CopyIcon size={12} />}
                        label="Copy result"
                        onClick={() => copy(safeResultText(toolCall.result))}
                      />
                    </HoverActionBar>
                    <pre
                      className={`${styles.code} ${
                        toolCall.isError ? styles.resultError : styles.result
                      }`}
                    >
                      {renderText(
                        safeResultText(toolCall.result).slice(0, 500) +
                          (safeResultText(toolCall.result).length > 500
                            ? "…"
                            : ""),
                      )}
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
                    <HoverActionBar
                      className={styles.sectionActions}
                      placement="top-right"
                    >
                      <HoverActionButton
                        icon={<Icons.CopyIcon size={12} />}
                        label="Copy result"
                        onClick={() => copy(safeResultText(toolCall.result))}
                      />
                    </HoverActionBar>
                    {renderResult(
                      `${styles.code} ${
                        toolCall.isError ? styles.resultError : styles.result
                      }`,
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
                      {renderText(child.text)}
                    </div>
                  ) : (
                    <ToolCall
                      key={child.toolCall.id}
                      toolCall={child.toolCall}
                      resolveImageSrc={props.resolveImageSrc}
                      resolveImageFallback={props.resolveImageFallback}
                      onImageActivate={props.onImageActivate}
                      onImageContextMenu={props.onImageContextMenu}
                      renderText={props.renderText}
                      renderMarkdown={props.renderMarkdown}
                      Container={Container}
                    />
                  ),
                )}
              </div>
            </div>
          )}

          {isPending && permissionActions && (
            <div className={styles.permissionActions}>{permissionActions}</div>
          )}
        </div>
      )}
    </Container>
  );
}
