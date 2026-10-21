import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  EmptyState,
  Icons,
  Markdown,
  MessageBubble,
  type MessageImage,
  parseQuestions,
  PlanApproval,
  QuestionForm,
  LimitResumeBanner,
  QueuedMessage,
  QueuedMessageAction,
  QueuedMessageEditor,
  QueuedMessageList,
  Spinner,
  TaskList,
  TodoList,
  ToolCall,
  type ToolCallData,
  type ToolResultBlockData,
} from "@argus/peacock";
import type {
  RemoteMessage,
  RemoteQueuedMessage,
  RemoteToolCall,
} from "../lib/protocol";
import {
  buildLinkedProjectsPreamble,
  parseLinkedProjectsPreamble,
} from "../lib/linkedProjects";
import { imageKey, useAppStore } from "../lib/store";
import { Mermaid } from "./Mermaid";
import { WorkingIndicator } from "./WorkingIndicator";

// Deny messages mirror the desktop's ToolCallCard so the agent gets the same
// guidance whichever client answers.
const CANCEL_QUESTION_MSG =
  "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them.";
const KEEP_PLANNING_MSG =
  "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided.";
const planFeedbackMsg = (feedback: string) =>
  `The user wants to refine the plan before approving it. Their feedback:\n\n${feedback}\n\nIncorporate this feedback and propose an updated plan via ExitPlanMode.`;

type ImageBlock = Extract<ToolResultBlockData, { type: "image" }>;

// --- Adapters: wire RemoteToolCall/RemoteMessage → pure Peacock data --------

function toToolCallData(tc: RemoteToolCall): ToolCallData {
  const pending = tc.status === "pending" || !!tc.pending_permission;
  const running = tc.status === "running";
  const result: ToolCallData["result"] =
    pending || running
      ? undefined
      : tc.result_blocks.map((b): ToolResultBlockData =>
          b.type === "image"
            ? { type: "image", mediaType: b.media_type, imageId: b.image_id }
            : { type: "text", text: b.text },
        );

  return {
    id: tc.id,
    name: tc.name,
    input: tc.input,
    isError: tc.is_error ?? tc.status === "error",
    pendingPermission: pending,
    result,
    children: tc.children?.map((c) =>
      c.kind === "text"
        ? { kind: "text" as const, text: c.text }
        : { kind: "tool_use" as const, toolCall: toToolCallData(c.tool_call) },
    ),
  };
}

/** Every image id referenced by a transcript, for lazy preloading. */
function collectImageIds(messages: RemoteMessage[]): string[] {
  const ids: string[] = [];
  const walk = (tc: RemoteToolCall) => {
    for (const b of tc.result_blocks) {
      if (b.type === "image") {
        ids.push(b.image_id);
      }
    }
    tc.children?.forEach((c) => {
      if (c.kind === "tool_use") {
        walk(c.tool_call);
      }
    });
  };
  for (const m of messages) {
    (m.images ?? []).forEach((img) => ids.push(img.image_id));
    m.tool_calls.forEach(walk);
  }

  return ids;
}

// Stable identities: fresh array/function props every render would churn
// Peacock's memoized `components`, remounting inline mermaid diagrams.
const renderMermaid = (code: string) => <Mermaid code={code} />;
const renderMarkdown = (text: string, className?: string) => (
  <Markdown className={className} text={text} renderMermaid={renderMermaid} />
);

/** Allow/Deny and the AskUserQuestion / ExitPlanMode forms, rendered inline on
 * the pending tool call — the desktop's flow, minus the desktop-only "Always
 * Allow" (the remote scope is monitor + approve). */
function pendingActions(
  agentId: string,
  tc: RemoteToolCall,
  respond: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
    message?: string,
  ) => Promise<void>,
): { pendingForm?: ReactNode; permissionActions?: ReactNode } {
  if (tc.name === "AskUserQuestion") {
    const questions = parseQuestions(tc.input);
    if (questions.length > 0) {
      return {
        pendingForm: (
          <QuestionForm
            questions={questions}
            onSubmit={(answer) => respond(agentId, tc.id, "deny", answer)}
            onCancel={() => respond(agentId, tc.id, "deny", CANCEL_QUESTION_MSG)}
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

const Message = memo(function Message({
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

  const resolveImageSrc = (block: ImageBlock) =>
    block.imageId ? imageCache[imageKey(agentId, block.imageId)] : undefined;

  const trimmed = msg.text_blocks
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const images: MessageImage[] = (msg.images ?? [])
    .map((img, i) => {
      const src = imageCache[imageKey(agentId, img.image_id)];

      return src ? { src, alt: `Attachment ${i + 1}` } : null;
    })
    .filter((x): x is MessageImage => x != null);

  const toolCalls =
    msg.tool_calls.length > 0
      ? msg.tool_calls.map((tc) => {
          const isPending =
            !answered[`${agentId}:${tc.id}`] &&
            (tc.status === "pending" ||
              !!tc.pending_permission ||
              prompts[`${agentId}:${tc.id}`] != null);
          const { pendingForm, permissionActions } = isPending
            ? pendingActions(agentId, tc, respond)
            : {};
          // Drive ToolCall's pending rendering off the live prompt too — the
          // snapshot's own flag can lag the permission.request event.
          const data = { ...toToolCallData(tc), pendingPermission: isPending };

          return (
            <ToolCall
              key={tc.id}
              toolCall={data}
              resolveImageSrc={resolveImageSrc}
              renderMarkdown={renderMarkdown}
              pendingForm={pendingForm}
              permissionActions={permissionActions}
            />
          );
        })
      : undefined;

  const mcp =
    msg.role === "system" && msg.source?.kind === "mcp"
      ? {
          label: msg.source.parent_label?.trim()
            ? `${msg.source.parent_label} → ${msg.source.tool}`
            : `MCP · ${msg.source.tool}`,
        }
      : undefined;

  return (
    <MessageBubble
      role={msg.role}
      mcp={mcp}
      author={msg.author}
      tone={msg.is_error ? "error" : undefined}
      timestamp={msg.timestamp}
      toolOnly={trimmed.length === 0 && !!toolCalls}
      textBlocks={trimmed}
      renderMarkdown={renderMarkdown}
      toolCalls={toolCalls}
      images={images}
    />
  );
});

export function AgentTranscript({ agentId }: { agentId: string }) {
  const connection = useAppStore((s) => s.connection);
  const serverMessages = useAppStore((s) => s.messagesByAgent[agentId]);
  const optimistic = useAppStore((s) => s.optimisticByAgent[agentId]);
  const tasks = useAppStore((s) => s.tasksByAgent[agentId]);
  const todos = useAppStore((s) => s.todosByAgent[agentId]);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const loadQueue = useAppStore((s) => s.loadQueue);
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages);
  const loadImage = useAppStore((s) => s.loadImage);
  const watchAgent = useAppStore((s) => s.watchAgent);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const queued = useAppStore((s) => s.queuedByAgent[agentId]);
  const hasControl = useAppStore((s) => s.hasControl());
  const dismissLimitResume = useAppStore((s) => s.dismissLimitResume);
  const limitResumeAt = useAppStore(
    (s) => s.statusByAgent[agentId]?.limit_resume_at ?? null,
  );
  const endRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  // Scroll height captured just before prepending older messages, so we can
  // restore the viewport position (otherwise the list jumps).
  const preScrollHeightRef = useRef<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);

  // Combine the authoritative snapshot with any not-yet-confirmed optimistic
  // user messages so a just-sent message shows instantly. Memoized so unrelated
  // re-renders don't hand the scroll/image effects a fresh array identity.
  const messages = useMemo(
    () =>
      serverMessages === undefined
        ? undefined
        : [...serverMessages, ...(optimistic ?? [])],
    [serverMessages, optimistic],
  );
  const hasTranscript = messages !== undefined;

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    // Status rides along with the transcript: a missed `agent.status` event
    // otherwise leaves the composer showing "send" through a whole turn.
    const refresh = () => {
      loadTranscript(agentId).catch(() => {});
      loadAgentStatus(agentId).catch(() => {});
    };
    // The queue lives on the computer; fetch it once, then follow agent.queue.
    loadQueue(agentId).catch(() => {});
    refresh();
    watchAgent(agentId, true);
    // Subscriptions are fire-and-forget, so any event the agent emits before the
    // gateway registers our subscription is never delivered (e.g. the first
    // question). A short re-fetch closes that race; a gentle poll + a refetch on
    // refocus recover from any other missed event without a manual back-and-forth.
    const raceCatch = setTimeout(refresh, 600);
    const poll = setInterval(refresh, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      watchAgent(agentId, false);
      clearTimeout(raceCatch);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [connection, agentId, loadQueue, loadTranscript, loadAgentStatus, watchAgent]);

  // Track scroll position: toggle the bottom pill, and lazy-load older history
  // when the user nears the top.
  useEffect(() => {
    const scroller = endRef.current?.closest(".aw-main");
    if (!scroller) {
      return;
    }
    const onScroll = () => {
      setIsAtBottom(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60,
      );
      if (
        scroller.scrollTop < 160 &&
        !loadingOlderRef.current &&
        useAppStore.getState().prevBeforeByAgent[agentId] != null
      ) {
        loadingOlderRef.current = true;
        preScrollHeightRef.current = scroller.scrollHeight;
        setLoadingOlder(true);
        loadOlderMessages(agentId)
          .catch(() => {})
          .finally(() => {
            loadingOlderRef.current = false;
            setLoadingOlder(false);
          });
      }
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => scroller.removeEventListener("scroll", onScroll);
    // `hasTranscript` re-runs this once the transcript actually mounts — on the
    // first render the loading branch has no endRef, so the listener would never
    // attach (breaking lazy-load + the scroll-to-bottom pill).
  }, [agentId, loadOlderMessages, hasTranscript]);

  // After older messages prepend, keep the viewport anchored on what the user
  // was reading by offsetting scrollTop by the newly-added height.
  useLayoutEffect(() => {
    if (preScrollHeightRef.current == null) {
      return;
    }
    const scroller = endRef.current?.closest(".aw-main");
    if (scroller) {
      scroller.scrollTop += scroller.scrollHeight - preScrollHeightRef.current;
    }
    preScrollHeightRef.current = null;
  }, [messages]);

  // Lazily fetch any images the transcript references.
  const imageIds = useMemo(
    () => (messages ? collectImageIds(messages) : []),
    [messages],
  );
  useEffect(() => {
    for (const id of imageIds) {
      loadImage(agentId, id).catch(() => {});
    }
  }, [agentId, imageIds, loadImage]);

  // Keep the newest message in view as the transcript streams — but only when
  // the user is already at the bottom, so scrolling up to read isn't yanked.
  // useLayoutEffect + direct scrollTop pins to the bottom *before* paint, so a
  // streamed message never flashes in at the old scroll position first.
  useLayoutEffect(() => {
    if (!isAtBottom) {
      return;
    }
    const scroller = endRef.current?.closest(".aw-main");
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, isAtBottom]);

  if (messages === undefined) {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Loading transcript…</span>
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="aw-transcript-list">
        <EmptyState
          icon={<Icons.AgentIcon size={22} />}
          title="No messages yet"
          body="This agent hasn't produced any output yet. New messages stream in live."
        />
        <WorkingIndicator agentId={agentId} />
        <div ref={endRef} />
      </div>
    );
  }

  return (
    <div className="aw-transcript-list">
      {loadingOlder && (
        <div className="aw-load-older">
          <Spinner size="sm" />
          <span className="aw-muted">Loading earlier messages…</span>
        </div>
      )}
      {tasks && tasks.length > 0 && <TaskList tasks={tasks} />}
      {todos && todos.length > 0 && <TodoList todos={todos} />}
      {messages.map((m) => (
        <Message key={m.id} agentId={agentId} msg={m} />
      ))}
      <WorkingIndicator agentId={agentId} />
      {limitResumeAt !== null && (
        <LimitResumeBanner
          resumeAt={limitResumeAt}
          onCancel={
            hasControl
              ? () => {
                  dismissLimitResume(agentId).catch(() => {});
                }
              : undefined
          }
        />
      )}
      {queued && queued.length > 0 && (
        <QueuedMessageList>
          {queued.map((q) => (
            <QueuedRow
              key={q.id}
              agentId={agentId}
              editing={editingQueuedId === q.id}
              message={q}
              onStartEdit={() => setEditingQueuedId(q.id)}
              onStopEdit={() => setEditingQueuedId(null)}
            />
          ))}
        </QueuedMessageList>
      )}
      <div ref={endRef} />
      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="aw-scroll-bottom"
          onClick={scrollToBottom}
        >
          <Icons.ChevronDownIcon size={12} />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

/**
 * One message still waiting in the queue: editable in place, since a remote is
 * usually where you notice you've typed the wrong thing.
 */
function QueuedRow({
  agentId,
  editing,
  message,
  onStartEdit,
  onStopEdit,
}: {
  agentId: string;
  editing: boolean;
  message: RemoteQueuedMessage;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  const removeQueued = useAppStore((s) => s.removeQueued);
  const updateQueued = useAppStore((s) => s.updateQueued);
  const sendQueuedNow = useAppStore((s) => s.sendQueuedNow);

  // `text` carries the linked-projects preamble; the editor only ever shows
  // what the user typed, and the preamble is rebuilt around whatever they save.
  const parsed = parseLinkedProjectsPreamble(message.text);
  const linkedPaths = parsed?.paths ?? [];
  const displayText = parsed?.rest ?? message.display_text ?? message.text;

  const remove = () => {
    // Dropping it throws away what you typed, so ask first.
    if (
      !window.confirm(
        `Remove this queued message?\n\n${displayText.slice(0, 200)}`,
      )
    ) {
      return;
    }
    removeQueued(agentId, message.id).catch(() => {});
  };

  return (
    <QueuedMessage
      author={message.author}
      text={editing ? undefined : displayText}
      actions={
        editing ? undefined : (
          <>
            <QueuedMessageAction
              icon={<Icons.SendIcon size={11} />}
              label="Send now (interrupts the current turn)"
              onClick={() => {
                sendQueuedNow(agentId, message.id).catch(() => {});
              }}
            />
            <QueuedMessageAction
              icon={<Icons.PencilIcon size={11} />}
              label="Edit queued message"
              onClick={onStartEdit}
            />
            <QueuedMessageAction
              icon={<Icons.CloseIcon size={12} />}
              label="Remove queued message"
              onClick={remove}
            />
          </>
        )
      }
    >
      {editing ? (
        <QueuedMessageEditor
          initialText={displayText}
          onCancel={onStopEdit}
          onSave={(text) => {
            // Cleared to nothing with no projects attached is a delete — there
            // would be no message left to send.
            if (text.length === 0 && linkedPaths.length === 0) {
              removeQueued(agentId, message.id).catch(() => {});
            } else {
              const next = buildLinkedProjectsPreamble(linkedPaths, text);
              if (next !== message.text) {
                updateQueued(agentId, message.id, next).catch(() => {});
              }
            }
            onStopEdit();
          }}
        />
      ) : undefined}
    </QueuedMessage>
  );
}
