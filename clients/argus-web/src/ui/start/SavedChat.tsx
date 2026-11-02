/**
 * `/sessions/:id/chats/:historyId`: a saved chat read back, folded like a live
 * one, with Resume to pick it up as a new agent and a pin to bring it back
 * when the computer restarts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { copyText, describeError } from "@argus/client-core";
import { Banner, Button, EmptyState, Icons, Spinner } from "@argus/peacock";
import type { RemoteMessage } from "../../lib/protocol";
import { openAgent } from "../../routing/open";
import { chatKey, useChatsStore } from "../../stores/chats";
import { useConnectionStore } from "../../stores/connection";
import { capture } from "../../telemetry/telemetry";
import { collectImageIds } from "../transcript/toolCallData";
import {
  type MessageMenu,
  TranscriptMessage,
} from "../transcript/TranscriptMessage";
import { TranscriptRows } from "../transcript/TranscriptRows";
import { useHeldSession } from "./useHeldSession";

const copyOnly: MessageMenu = {
  canChange: false,
  onCopy: (msg) => {
    const text = copyText(msg);
    if (text) {
      void navigator.clipboard?.writeText(text).catch(() => {});
      capture("web_message_action", {
        action: "copy",
        role: msg.role === "user" ? "user" : "assistant",
        success: true,
      });
    }
  },
  onEdit: () => {},
  onFork: () => {},
};

export function SavedChat({
  sessionId,
  historyId,
}: {
  sessionId: string;
  historyId: string;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const session = useHeldSession(sessionId);
  const repoRoot = session?.repo_root ?? null;
  const key = repoRoot ? chatKey(repoRoot, historyId) : "";
  const transcript = useChatsStore((s) => s.transcripts[key]);
  const images = useChatsStore((s) => s.images);
  const chat = useChatsStore((s) =>
    repoRoot
      ? s.stoppedByRepo[repoRoot]?.find((c) => c.history_id === historyId)
      : undefined,
  );
  const { loadStopped, loadTranscript, loadImage, resume, setPinned } =
    useChatsStore();
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection === "ready" && repoRoot) {
      void loadTranscript(repoRoot, historyId);
      void loadStopped(repoRoot);
    }
  }, [connection, historyId, loadStopped, loadTranscript, repoRoot]);

  const messages = transcript?.messages;
  const imageIds = useMemo(
    () => (messages ? collectImageIds(messages) : []),
    [messages],
  );
  useEffect(() => {
    if (repoRoot) {
      for (const id of imageIds) {
        void loadImage(repoRoot, historyId, id);
      }
    }
  }, [historyId, imageIds, loadImage, repoRoot]);

  const imageSrc = useCallback(
    (imageId: string) => images[`${key}:${imageId}`],
    [images, key],
  );
  const renderMessage = (msg: RemoteMessage) => (
    <TranscriptMessage
      agentId={historyId}
      imageSrc={imageSrc}
      live={false}
      menu={copyOnly}
      msg={msg}
    />
  );

  if (session === null) {
    return (
      <EmptyState
        icon={<Icons.HistoryIcon size={22} />}
        title="Chat not found"
        body="Its session may have been deleted on your computer."
      />
    );
  }
  if (!messages) {
    return transcript?.error ? (
      <EmptyState
        icon={<Icons.WarningIcon size={22} />}
        title="Couldn't load the chat"
        body={transcript.error}
      />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Loading the chat…</span>
      </div>
    );
  }

  return (
    <div className="aw-transcript-list">
      {hasControl && chat && (
        <div className="aw-chat-actions">
          <Button
            disabled={resuming || connection !== "ready"}
            leading={<Icons.PlayIcon size={11} />}
            variant="primary"
            onClick={() => {
              setResuming(true);
              setError(null);
              resume(chat, sessionId)
                .then((agent) => openAgent(agent, { replace: true }))
                .catch((err: unknown) => setError(describeError(err)))
                .finally(() => setResuming(false));
            }}
          >
            {resuming ? "Resuming…" : "Resume"}
          </Button>
          {!chat.imported_from && repoRoot && (
            <Button
              leading={<Icons.PinIcon size={11} />}
              title={
                chat.pinned
                  ? "Stop resuming it when the computer restarts"
                  : "Resume it when the computer restarts"
              }
              variant="secondary"
              onClick={() => {
                setPinned(repoRoot, historyId, !chat.pinned).catch(
                  (err: unknown) => setError(describeError(err)),
                );
              }}
            >
              {chat.pinned ? "Unpin" : "Pin"}
            </Button>
          )}
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {messages.length === 0 ? (
        <EmptyState
          icon={<Icons.HistoryIcon size={22} />}
          title="Nothing in this chat"
        />
      ) : (
        <TranscriptRows
          agentId={historyId}
          agentRunning={false}
          messages={messages}
          renderMessage={renderMessage}
        />
      )}
    </div>
  );
}
