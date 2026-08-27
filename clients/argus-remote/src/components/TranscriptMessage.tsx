/**
 * One transcript message: text, inline tool calls, attached images, and the
 * inline permission form when a call is waiting on an answer.
 */

import { memo, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";
import { PlanApproval } from "./PlanApproval";
import { QuestionForm } from "./QuestionForm";
import { ToolCallCard } from "./ToolCallCard";
import { Btn } from "./ui";
import type { RemoteMessage, RemoteToolCall } from "../lib/protocol";
import { parseQuestions } from "../lib/questions";
import { imageKey, useAppStore } from "../stores/appStore";

// Deny messages mirror the desktop's ToolCallCard so the agent gets the same
// guidance whichever client answers.
const CANCEL_QUESTION_MSG =
  "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them.";
const KEEP_PLANNING_MSG =
  "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided.";
const planFeedbackMsg = (feedback: string) =>
  `The user wants to refine the plan before approving it. Their feedback:\n\n${feedback}\n\nIncorporate this feedback and propose an updated plan via ExitPlanMode.`;

type Respond = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
  message?: string,
) => Promise<void>;

/**
 * Whether a tool call is waiting on the user. Driven off the live prompt too —
 * the snapshot's own flag can lag the permission.request event.
 */
export function isToolCallPending(
  agentId: string,
  tc: RemoteToolCall,
  prompts: Record<string, unknown>,
  answered: Record<string, true>,
): boolean {
  return (
    !answered[`${agentId}:${tc.id}`] &&
    (tc.status === "pending" ||
      !!tc.pending_permission ||
      prompts[`${agentId}:${tc.id}`] != null)
  );
}

/** The AskUserQuestion / ExitPlanMode forms rendered inline on a pending call. */
function pendingForm(
  agentId: string,
  tc: RemoteToolCall,
  respond: Respond,
): React.ReactNode {
  if (tc.name === "AskUserQuestion") {
    const questions = parseQuestions(tc.input);
    if (questions.length > 0) {
      return (
        <QuestionForm
          questions={questions}
          onSubmit={(answer) => respond(agentId, tc.id, "deny", answer)}
          onCancel={() => respond(agentId, tc.id, "deny", CANCEL_QUESTION_MSG)}
        />
      );
    }
  }
  if (tc.name === "ExitPlanMode" && typeof tc.input.plan === "string") {
    return (
      <PlanApproval
        plan={tc.input.plan}
        onApprove={() => respond(agentId, tc.id, "allow")}
        onReject={() => respond(agentId, tc.id, "deny", KEEP_PLANNING_MSG)}
        onSubmitFeedback={(f) =>
          respond(agentId, tc.id, "deny", planFeedbackMsg(f))
        }
      />
    );
  }

  return undefined;
}

export const TranscriptMessage = memo(function TranscriptMessage({
  agentId,
  msg,
}: {
  agentId: string;
  msg: RemoteMessage;
}) {
  const imageCache = useAppStore((s) => s.imageCache);
  const prompts = useAppStore((s) => s.prompts);
  const answered = useAppStore((s) => s.answered);
  const respond = useAppStore((s) => s.respond);

  const resolveImage = useCallback(
    (imageId: string) => imageCache[imageKey(agentId, imageId)],
    [agentId, imageCache],
  );

  const trimmed = msg.text_blocks.map((t) => t.trim()).filter((t) => t.length > 0);
  const images = (msg.images ?? [])
    .map((img) => imageCache[imageKey(agentId, img.image_id)])
    .filter((uri): uri is string => Boolean(uri))
    .map((uri) => ({ uri }));

  const toolCalls =
    msg.tool_calls.length > 0
      ? msg.tool_calls.map((tc) => {
          const isPending = isToolCallPending(agentId, tc, prompts, answered);
          const form = isPending ? pendingForm(agentId, tc, respond) : undefined;

          return (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              resolveImage={resolveImage}
              isPending={isPending}
              pendingForm={form}
              permissionActions={
                isPending && !form ? (
                  <>
                    <Btn
                      label="Allow"
                      size="sm"
                      onPress={() => respond(agentId, tc.id, "allow")}
                    />
                    <Btn
                      label="Deny"
                      size="sm"
                      tone="ghost"
                      onPress={() => respond(agentId, tc.id, "deny")}
                    />
                  </>
                ) : undefined
              }
            />
          );
        })
      : undefined;

  const mcpLabel =
    msg.role === "system" && msg.source?.kind === "mcp"
      ? msg.source.parent_label?.trim()
        ? `${msg.source.parent_label} → ${msg.source.tool}`
        : `MCP · ${msg.source.tool}`
      : undefined;

  return (
    <MessageBubble
      role={msg.role}
      mcpLabel={mcpLabel}
      isError={msg.is_error}
      timestamp={msg.timestamp}
      toolOnly={trimmed.length === 0 && !!toolCalls}
      textBlocks={trimmed}
      toolCalls={toolCalls}
      images={images}
    />
  );
});
