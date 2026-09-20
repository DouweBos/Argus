/**
 * The agent transcript: structured messages with inline tool calls, pending
 * permission forms (Allow/Deny, AskUserQuestion, ExitPlanMode), task/todo
 * lists, queued messages and the working indicator. Runs of tool-call-only
 * messages fold into a collapsed group. Live-refreshes off agent events with a
 * poll + refocus fallback, and lazy-loads older history on scroll-up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { CollapsedToolGroup } from "./CollapsedToolGroup";
import * as Icons from "./Icons";
import { TaskList, TodoList } from "./TaskList";
import { TranscriptMessage } from "./TranscriptMessage";
import {
  Card,
  EmptyState,
  Loading,
  Muted,
  Row,
  Spinner,
  useContentInsets,
} from "./ui";
import { WorkingIndicator } from "./WorkingIndicator";
import type {
  RemoteMessage,
  RemoteQueuedMessage,
  RemoteToolCall,
} from "../lib/protocol";
import { groupMessages } from "../lib/toolGroups";
import { openImageViewer } from "../stores/imageViewerStore";
import { useAppStore } from "../stores/appStore";
import { useTheme } from "../theme";

const POLL_MS = 5000;
/** Scroll-from-top distance that triggers loading the previous page. */
const LOAD_OLDER_THRESHOLD = 160;
const AT_BOTTOM_THRESHOLD = 60;

/** A message still waiting to be sent, with whatever was attached to it. */
function QueuedCard({
  message,
  onRemove,
}: {
  message: RemoteQueuedMessage;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const uris = (message.images ?? []).map(
    (img) => `data:${img.media_type};base64,${img.data}`,
  );

  return (
    <Card style={{ opacity: 0.75, gap: 8 }}>
      <Row gap={8}>
        <Muted numberOfLines={3} style={{ flex: 1 }}>
          Queued · {message.display_text ?? message.text}
        </Muted>
        <Pressable
          accessibilityLabel="Remove queued message"
          hitSlop={8}
          onPress={onRemove}
        >
          <Icons.Close size={13} color={theme.textMuted} />
        </Pressable>
      </Row>

      {uris.length > 0 && (
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {uris.map((uri, i) => (
            <Pressable
              key={i}
              accessibilityLabel="View attached image"
              onPress={() => openImageViewer(uris, i)}
            >
              <Image
                source={{ uri }}
                resizeMode="cover"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: theme.radiusSm,
                  backgroundColor: theme.bgTertiary,
                }}
              />
            </Pressable>
          ))}
        </Row>
      )}
    </Card>
  );
}

/** Dropping a queued message throws away what you typed, so ask first. */
function confirmRemoveQueued(
  message: RemoteQueuedMessage,
  remove: () => void,
): void {
  const preview = message.display_text ?? message.text;
  Alert.alert(
    "Remove queued message?",
    preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: remove },
    ],
  );
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
  const loadQueue = useAppStore((s) => s.loadQueue);
  const loadOlderMessages = useAppStore((s) => s.loadOlderMessages);
  const loadImage = useAppStore((s) => s.loadImage);
  const watchAgent = useAppStore((s) => s.watchAgent);

  const scrollRef = useRef<ScrollViewInstance>(null);
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
  const segments = useMemo(
    () => (messages ? groupMessages(messages) : []),
    [messages],
  );

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    const refresh = () => loadTranscript(agentId).catch(() => {});
    refresh();
    // The queue lives on the computer; fetch it once, then follow agent.queue.
    loadQueue(agentId).catch(() => {});
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
  }, [agentId, connection, loadQueue, loadTranscript, watchAgent]);

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
  const stickToBottom = useCallback(() => {
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
        onContentSizeChange={stickToBottom}
        // The viewport shrinks when the keyboard opens; without this the last
        // message stays scrolled off the bottom.
        onLayout={stickToBottom}
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

        {segments.map((segment) =>
          segment.type === "collapsed" ? (
            <CollapsedToolGroup
              key={segment.messages[0].id}
              agentId={agentId}
              messages={segment.messages}
            />
          ) : (
            <TranscriptMessage
              key={segment.message.id}
              agentId={agentId}
              msg={segment.message}
            />
          ),
        )}

        <WorkingIndicator agentId={agentId} />

        {queued && queued.length > 0
          ? queued.map((q) => (
              <QueuedCard
                key={q.id}
                message={q}
                onRemove={() =>
                  confirmRemoveQueued(q, () => {
                    removeQueued(agentId, q.id).catch(() => {});
                  })
                }
              />
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
