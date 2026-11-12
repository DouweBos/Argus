/**
 * One transcript message: its bubble, its tool calls with any decision they
 * wait on drawn inline, and the copy / edit / fork menu.
 */

import { memo, type ReactNode } from "react";
import {
  displayBlocks,
  editableText,
  messageMenuOptions,
} from "@argus/client-core";
import {
  Button,
  CommandMessage,
  Markdown,
  MessageActions,
  MessageBubble,
  MessageEditForm,
  type MessageImage,
  parseQuestions,
  PlanApproval,
  QuestionForm,
  ToolCall,
} from "@argus/peacock";
import type { RemoteMessage, RemoteToolCall } from "../../lib/protocol";
import { usePromptsStore } from "../../stores/prompts";
import { Mermaid } from "../Mermaid";
import { type ImageBlock, mcpLabel, toToolCallData } from "./toolCallData";

// Deny messages mirror the desktop's ToolCallCard so the agent gets the same
// guidance whichever client answers.
const CANCEL_QUESTION_MSG =
  "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them.";
const KEEP_PLANNING_MSG =
  "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided.";
const planFeedbackMsg = (feedback: string) =>
  `The user wants to refine the plan before approving it. Their feedback:\n\n${feedback}\n\nIncorporate this feedback and propose an updated plan via ExitPlanMode.`;

// Stable identities: fresh array/function props every render would churn
// Peacock's memoized `components`, remounting inline mermaid diagrams.
const renderMermaid = (code: string) => <Mermaid code={code} />;
export const renderMarkdown = (text: string, className?: string) => (
  <Markdown className={className} text={text} renderMermaid={renderMermaid} />
);

type Respond = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  message?: string,
) => Promise<void>;

/** Allow/Deny and the AskUserQuestion / ExitPlanMode forms, inline on the pending call. */
function pendingActions(
  agentId: string,
  tc: RemoteToolCall,
  respond: Respond,
): { pendingForm?: ReactNode; permissionActions?: ReactNode } {
  if (tc.name === "AskUserQuestion") {
    const questions = parseQuestions(tc.input);
    if (questions.length > 0) {
      return {
        pendingForm: (
          <QuestionForm
            questions={questions}
            onSubmit={(answer) => respond(agentId, tc.id, "deny", answer)}
            onCancel={() =>
              respond(agentId, tc.id, "deny", CANCEL_QUESTION_MSG)
            }
          />
        ),
      };
    }
  }
  if (tc.name === "ExitPlanMode" && typeof tc.input.plan === "string") {
    return {
      pendingForm: (
        <PlanApproval
          plan={tc.input.plan}
          renderMarkdown={renderMarkdown}
          onApprove={() => respond(agentId, tc.id, "allow")}
          onReject={() => respond(agentId, tc.id, "deny", KEEP_PLANNING_MSG)}
          onSubmitFeedback={(f) =>
            respond(agentId, tc.id, "deny", planFeedbackMsg(f))
          }
        />
      ),
    };
  }

  return {
    permissionActions: (
      <>
        <Button
          variant="primary"
          size="sm"
          onClick={() => respond(agentId, tc.id, "allow")}
        >
          Allow
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => respond(agentId, tc.id, "deny")}
        >
          Deny
        </Button>
      </>
    ),
  };
}

/** What a message's menu does; absent, it has none. */
export interface MessageMenu {
  /** Edit and fork act on a live chat this device controls; otherwise only copy. */
  canChange: boolean;
  onCopy: (msg: RemoteMessage) => void;
  onEdit: (msg: RemoteMessage) => void;
  onFork: (msg: RemoteMessage) => void;
}

/** An edit in progress on this message. */
export interface MessageEdit {
  busy: boolean;
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
}

interface TranscriptMessageProps {
  agentId: string;
  msg: RemoteMessage;
  imageSrc: (imageId: string) => string | undefined;
  /** Draw decisions waiting on the user; a saved chat has none. */
  live: boolean;
  menu?: MessageMenu;
  edit?: MessageEdit;
}

export const TranscriptMessage = memo(function TranscriptMessage({
  agentId,
  msg,
  imageSrc,
  live,
  menu,
  edit,
}: TranscriptMessageProps) {
  const prompts = usePromptsStore((s) => s.prompts);
  const answered = usePromptsStore((s) => s.answered);
  const respond = usePromptsStore((s) => s.respond);

  if (edit) {
    return (
      <MessageEditForm
        busy={edit.busy}
        error={edit.error}
        hint="The chat rewinds to this message; everything after it is discarded."
        initialText={editableText(msg)}
        saveLabel={edit.busy ? "Restoring…" : "Edit & restore"}
        timestamp={msg.timestamp}
        onCancel={edit.onCancel}
        onSave={edit.onSave}
      />
    );
  }

  const resolveImageSrc = (block: ImageBlock) =>
    block.imageId ? imageSrc(block.imageId) : undefined;
  const blocks = displayBlocks(msg).map((t) => t.trim());
  const images: MessageImage[] = (msg.images ?? [])
    .map((img, i) => {
      const src = imageSrc(img.image_id);

      return src ? { src, alt: `Attachment ${i + 1}` } : null;
    })
    .filter((x): x is MessageImage => x != null);

  const toolCalls =
    msg.tool_calls.length > 0
      ? msg.tool_calls.map((tc) => {
          const key = `${agentId}:${tc.id}`;
          const isPending =
            live &&
            !answered[key] &&
            (tc.status === "pending" ||
              !!tc.pending_permission ||
              prompts[key] != null);
          const { pendingForm, permissionActions } = isPending
            ? pendingActions(agentId, tc, respond)
            : {};

          return (
            <ToolCall
              key={tc.id}
              // The live prompt drives pending rendering: the snapshot's own flag can lag it.
              toolCall={{ ...toToolCallData(tc), pendingPermission: isPending }}
              resolveImageSrc={resolveImageSrc}
              renderMarkdown={renderMarkdown}
              pendingForm={pendingForm}
              permissionActions={permissionActions}
            />
          );
        })
      : undefined;

  const options = menu ? messageMenuOptions(msg, menu.canChange) : null;
  const actions = options && menu && (
    <MessageActions
      onCopy={options.copy ? () => menu.onCopy(msg) : undefined}
      onEdit={options.edit ? () => menu.onEdit(msg) : undefined}
      onFork={options.fork ? () => menu.onFork(msg) : undefined}
    />
  );

  return (
    <MessageBubble
      role={msg.role}
      mcp={mcpLabel(msg)}
      author={msg.author}
      tone={msg.is_error ? "error" : undefined}
      timestamp={msg.timestamp}
      toolOnly={blocks.length === 0 && !!toolCalls}
      textBlocks={blocks}
      content={
        msg.command && (
          <CommandMessage args={msg.command.args} name={msg.command.name} />
        )
      }
      renderMarkdown={renderMarkdown}
      toolCalls={toolCalls}
      images={images}
      actions={actions || undefined}
    />
  );
});
