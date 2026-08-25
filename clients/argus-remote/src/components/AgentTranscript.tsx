/**
 * The agent transcript: structured messages with inline tool calls, pending
 * permission forms (Allow/Deny, AskUserQuestion, ExitPlanMode), task/todo
 * lists, queued messages and the working indicator. Live-refreshes off agent
 * events with a poll + refocus fallback, and lazy-loads older history on
 * scroll-up.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import * as Icons from "./Icons";
import { MessageBubble } from "./MessageBubble";
import { PlanApproval } from "./PlanApproval";
import { QuestionForm } from "./QuestionForm";
import { TaskList, TodoList } from "./TaskList";
import { ToolCallCard } from "./ToolCallCard";
import {
  Btn,
  Card,
  EmptyState,
  Loading,
  Muted,
  Row,
  Spinner,
  useContentInsets,
} from "./ui";
import { WorkingIndicator } from "./WorkingIndicator";
import type { RemoteMessage, RemoteToolCall } from "../lib/protocol";
import { parseQuestions } from "../lib/questions";
import { imageKey, useAppStore } from "../stores/appStore";
import { useTheme } from "../theme";

// Deny messages mirror the desktop's ToolCallCard so the agent gets the same
// guidance whichever client answers.
const CANCEL_QUESTION_MSG =
  "The user cancelled the question prompt without answering. Proceed with reasonable assumptions and note them.";
const KEEP_PLANNING_MSG =
  "The user rejected the plan and wants to keep refining it. Incorporate their feedback once provided.";
const planFeedbackMsg = (feedback: string) =>
  `The user wants to refine the plan before approving it. Their feedback:\n\n${feedback}\n\nIncorporate this feedback and propose an updated plan via ExitPlanMode.`;

const POLL_MS = 5000;
/** Scroll-from-top distance that triggers loading the previous page. */
const LOAD_OLDER_THRESHOLD = 160;
const AT_BOTTOM_THRESHOLD = 60;

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
          // Drive pending rendering off the live prompt too — the snapshot's own
          // flag can lag the permission.request event.
          const isPending =
            !answered[`${agentId}:${tc.id}`] &&
            (tc.status === "pending" ||
              !!tc.pending_permission ||
              prompts[`${agentId}:${tc.id}`] != null);
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

/** The AskUserQuestion / ExitPlanMode forms rendered inline on a pending call. */
function pendingForm(
  agentId: string,
  tc: RemoteToolCall,
  respond: (
    agentId: string,
    toolUseId: string,
    decision: "allow" | "deny",
    message?: string,
  ) => Promise<void>,
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

export function AgentTranscript({ agentId }: { agentId: string }) {
  const theme = useTheme();
  const insets = useContentInsets();
  const connection = useAppStore((s) => s.connection);
  const serverMessages = useAppStore((s) => s.messagesByAgent[agentId]);
  const optimistic = useAppStore((s) => s.optimisticByAgent[agentId]);
  const tasks = useAppStore((s) => s.tasksByAgent[agentId]);
  const todos = useAppStore((s) => s.todosByAgent[agentId]);
  const queued = useAppStore((s) => s.queuedByAgent[agentId]);
  const removeQueued = useAppStore((s) => s.removeQueued);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages);
  const loadImage = useAppStore((s) => s.loadImage);
  const watchAgent = useAppStore((s) => s.watchAgent);

  const scrollRef = useRef<ScrollView>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const messages = useMemo(
    () =>
      serverMessages === undefined
        ? undefined
        : [...serverMessages, ...(optimistic ?? [])],
    [serverMessages, optimistic],
  );

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    const refresh = () => loadTranscript(agentId).catch(() => {});
    refresh();
    watchAgent(agentId, true);
    // Subscriptions are fire-and-forget, so an event the agent emits before the
    // gateway registers ours is never delivered (e.g. the first question). A
    // short re-fetch closes that race; a gentle poll + a refetch on foreground
    // recover from any other missed event.
    const raceCatch = setTimeout(refresh, 600);
    const poll = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });

    return () => {
      watchAgent(agentId, false);
      clearTimeout(raceCatch);
      clearInterval(poll);
      sub.remove();
    };
  }, [agentId, connection, loadTranscript, watchAgent]);

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

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      const isAtBottom = distanceFromBottom < AT_BOTTOM_THRESHOLD;
      atBottomRef.current = isAtBottom;
      setAtBottom(isAtBottom);

      if (
        contentOffset.y < LOAD_OLDER_THRESHOLD &&
        !loadingOlderRef.current &&
        useAppStore.getState().prevBeforeByAgent[agentId] != null
      ) {
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        loadOlderMessages(agentId)
          .catch(() => {})
          .finally(() => {
            loadingOlderRef.current = false;
            setLoadingOlder(false);
          });
      }
    },
    [agentId, loadOlderMessages],
  );

  // Keep the newest message in view as the transcript streams — but only when
  // the user is already at the bottom, so scrolling up to read isn't yanked.
  const onContentSizeChange = useCallback(() => {
    if (atBottomRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  if (messages === undefined) {
    return <Loading label="Loading transcript…" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={onContentSizeChange}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.space,
          paddingBottom: theme.space + insets.bottom,
          gap: 10,
        }}
        style={{ backgroundColor: theme.bg }}
      >
        {loadingOlder && (
          <Row gap={8} style={{ justifyContent: "center" }}>
            <Spinner />
            <Muted>Loading earlier messages…</Muted>
          </Row>
        )}

        {messages.length === 0 && (
          <EmptyState
            icon={<Icons.Agent size={22} color={theme.textMuted} />}
            title="No messages yet"
            body="This agent hasn't produced any output yet. New messages stream in live."
          />
        )}

        {tasks && tasks.length > 0 ? <TaskList tasks={tasks} /> : null}
        {todos && todos.length > 0 ? <TodoList todos={todos} /> : null}

        {messages.map((m) => (
          <Message key={m.id} agentId={agentId} msg={m} />
        ))}

        <WorkingIndicator agentId={agentId} />

        {queued && queued.length > 0
          ? queued.map((q) => (
              <Card key={q.id} style={{ opacity: 0.75 }}>
                <Row gap={8}>
                  <Muted numberOfLines={3} style={{ flex: 1 }}>
                    Queued · {q.displayText}
                  </Muted>
                  <Pressable
                    accessibilityLabel="Remove queued message"
                    hitSlop={8}
                    onPress={() => removeQueued(agentId, q.id)}
                  >
                    <Icons.Close size={13} color={theme.textMuted} />
                  </Pressable>
                </Row>
              </Card>
            ))
          : null}
      </ScrollView>

      {!atBottom && (
        <Pressable
          accessibilityLabel="Scroll to bottom"
          onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
          style={{
            position: "absolute",
            alignSelf: "center",
            bottom: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: theme.bgTertiary,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Icons.ChevronDown size={12} color={theme.textSecondary} />
          <Muted>Scroll to bottom</Muted>
        </Pressable>
      )}
    </View>
  );
}
