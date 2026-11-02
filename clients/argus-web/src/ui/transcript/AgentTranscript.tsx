/**
 * A live agent's chat: turns folded into "Worked for…" lines, decisions drawn
 * inline, the message menu, the computer-side queue, and the limit banners.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyState,
  Icons,
  LimitResumeBanner,
  QueuedMessageList,
  Spinner,
  TaskList,
  TodoList,
} from "@argus/peacock";
import type { RemoteMessage } from "../../lib/protocol";
import { useAgentsStore } from "../../stores/agents";
import { useConnectionStore } from "../../stores/connection";
import { imageKey, useTranscriptsStore } from "../../stores/transcripts";
import { WorkingIndicator } from "../WorkingIndicator";
import { collectImageIds } from "./toolCallData";
import { LimitHandoff } from "./LimitHandoff";
import { QueuedRow } from "./QueuedRow";
import { TranscriptMessage } from "./TranscriptMessage";
import { TranscriptRows } from "./TranscriptRows";
import { useMessageMenu } from "./useMessageMenu";
import { useTranscriptScroll } from "./useTranscriptScroll";

/** Follow the agent while it is on screen, with a gentle poll behind the events. */
function useFollowAgent(agentId: string): void {
  const connection = useConnectionStore((s) => s.connection);
  const loadTranscript = useTranscriptsStore((s) => s.loadTranscript);
  const loadQueue = useAgentsStore((s) => s.loadQueue);
  const watchAgent = useAgentsStore((s) => s.watchAgent);
  const loadAgentStatus = useAgentsStore((s) => s.loadAgentStatus);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    // Status rides along: a missed `agent.status` otherwise leaves the composer on "send" all turn.
    const refresh = () => {
      loadTranscript(agentId).catch(() => {});
      loadAgentStatus(agentId).catch(() => {});
    };
    loadQueue(agentId).catch(() => {});
    refresh();
    watchAgent(agentId, true);
    // Events before the subscription lands are never delivered; a quick refetch closes that race.
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
}

export function AgentTranscript({
  agentId,
  messageMenu = true,
}: {
  agentId: string;
  /** Copy / edit / fork; a huddle guest goes without. */
  messageMenu?: boolean;
}) {
  const serverMessages = useTranscriptsStore((s) => s.messagesByAgent[agentId]);
  const optimistic = useTranscriptsStore((s) => s.optimisticByAgent[agentId]);
  const tasks = useTranscriptsStore((s) => s.tasksByAgent[agentId]);
  const todos = useTranscriptsStore((s) => s.todosByAgent[agentId]);
  const imageCache = useTranscriptsStore((s) => s.imageCache);
  const loadOlderMessages = useTranscriptsStore((s) => s.loadOlderMessages);
  const loadImage = useTranscriptsStore((s) => s.loadImage);
  const queued = useAgentsStore((s) => s.queuedByAgent[agentId]);
  const status = useAgentsStore((s) => s.statusByAgent[agentId]);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const dismissLimitResume = useAgentsStore((s) => s.dismissLimitResume);
  const endRef = useRef<HTMLDivElement>(null);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const { menu, editFor, dialog } = useMessageMenu(agentId, messageMenu);
  useFollowAgent(agentId);

  // The snapshot plus not-yet-confirmed sends, so a message shows the moment it's sent.
  const messages = useMemo(
    () =>
      serverMessages === undefined
        ? undefined
        : [...serverMessages, ...(optimistic ?? [])],
    [serverMessages, optimistic],
  );
  const { isAtBottom, loadingOlder, scrollToBottom } = useTranscriptScroll({
    endRef,
    content: messages,
    mounted: messages !== undefined,
    canLoadOlder: () =>
      useTranscriptsStore.getState().prevBeforeByAgent[agentId] != null,
    loadOlder: () => loadOlderMessages(agentId),
  });

  const imageIds = useMemo(
    () => (messages ? collectImageIds(messages) : []),
    [messages],
  );
  useEffect(() => {
    for (const id of imageIds) {
      loadImage(agentId, id).catch(() => {});
    }
  }, [agentId, imageIds, loadImage]);

  const imageSrc = useCallback(
    (imageId: string) => imageCache[imageKey(agentId, imageId)],
    [agentId, imageCache],
  );
  const renderMessage = (msg: RemoteMessage) => (
    <TranscriptMessage
      agentId={agentId}
      edit={editFor(msg)}
      imageSrc={imageSrc}
      live
      menu={menu}
      msg={msg}
    />
  );

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

  const limitResumeAt = status?.limit_resume_at ?? null;

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
      <TranscriptRows
        agentId={agentId}
        agentRunning={status?.status === "running"}
        messages={messages}
        renderMessage={renderMessage}
      />
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
      {status?.limit_stalled && <LimitHandoff agentId={agentId} />}
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
      {dialog}
    </div>
  );
}
