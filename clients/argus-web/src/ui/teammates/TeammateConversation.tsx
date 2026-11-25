/**
 * A teammate's conversation: opening it starts or wakes its agent, then it is
 * the agent screen's transcript, with the composer docked below by `Monitor`.
 * Its other conversations sit in a list behind the Conversations button.
 */

import type { TeammateThread } from "@argus/remote-protocol";
import { useEffect, useRef, useState } from "react";
import {
  describeError,
  formatRelative,
  threadFailureDetail,
  threadFailureTitle,
} from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  Icons,
  PickerPopover,
  Spinner,
  TeammatePageBar,
  TeammateThreadList,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import type { Screen } from "../../routing/screens";
import { useAgentsStore } from "../../stores/agents";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { AgentTranscript } from "../transcript/AgentTranscript";
import styles from "./TeammateConversation.module.css";
import { showTeammatePage } from "./teammateNav";

/** The agent a teammate conversation on screen talks to, for the docked composer. */
export function useTeammateChatAgent(screen: Screen): string | null {
  return useTeammatesStore((s) => {
    if (screen.name !== "teammate" || screen.page !== "chat") {
      return null;
    }
    const opened = s.openedById[screen.teammateId];
    if (!opened || (screen.threadId && opened.thread.id !== screen.threadId)) {
      return null;
    }

    return opened.agent_id;
  });
}

const SURFACE_LABELS: Record<TeammateThread["surface"], string | undefined> = {
  direct: undefined,
  handoff: "Handoff",
  linear: "Linear",
  slack: "Slack",
};

function openThread(teammateId: string, threadId: string): void {
  appNavigate({ name: "teammate", teammateId, page: "chat", threadId });
}

export function TeammateConversation({
  teammateId,
  threadId,
}: {
  teammateId: string;
  threadId: string | null;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const threads = useTeammatesStore((s) => s.threadsById[teammateId]);
  const opened = useTeammatesStore((s) => s.openedById[teammateId]);
  const store = useTeammatesStore.getState;
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resuming, setResuming] = useState(false);
  const listTrigger = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void store()
      .loadThreads(teammateId)
      .catch(() => {});
    // Opening starts or wakes its agent: control only. Monitor reads the transcript.
    if (!hasControl) {
      return;
    }
    setFailed(null);
    store()
      .openThread(teammateId, threadId)
      .catch((err: unknown) => setFailed(describeError(err)));
  }, [ready, hasControl, teammateId, threadId, store, attempt]);

  const startFresh = async () => {
    setCreating(true);
    try {
      const fresh = await store().openThread(teammateId, null, true);
      setListOpen(false);
      openThread(teammateId, fresh.thread.id);
    } catch (err) {
      setFailed(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const archive = async (id: string) => {
    const shown = opened?.thread.id ?? threadId;
    if ((await store().archiveThread(teammateId, id)) && id === shown) {
      appNavigate(
        { name: "teammate", teammateId, page: "chat", threadId: null },
        { replace: true },
      );
    }
  };

  const current =
    opened && (!threadId || opened.thread.id === threadId) ? opened : null;
  // Without control there is nothing opened: read the named or newest thread's agent.
  const readOnlyThread = hasControl
    ? null
    : (threads?.find((t) => t.id === threadId) ?? threads?.[0] ?? null);
  const agentId = current?.agent_id ?? readOnlyThread?.agent_id ?? null;
  const selectedId = current?.thread.id ?? readOnlyThread?.id ?? null;

  const agentStatus = useAgentsStore((s) =>
    agentId ? s.statusByAgent[agentId]?.status : undefined,
  );
  // A turn ending is when its failure lands on the thread.
  useEffect(() => {
    if (ready && agentStatus) {
      void store()
        .loadThreads(teammateId)
        .catch(() => {});
    }
  }, [ready, agentStatus, teammateId, store]);

  const shownThread = threads?.find((t) => t.id === selectedId) ?? null;
  const failure = shownThread?.failure ?? null;

  const resume = async () => {
    if (!selectedId) {
      return;
    }
    setResuming(true);
    try {
      await store().resumeThread(teammateId, selectedId);
    } catch (err) {
      setFailed(describeError(err));
    } finally {
      setResuming(false);
    }
  };

  let body;
  if (agentId) {
    body = <AgentTranscript agentId={agentId} key={agentId} />;
  } else if (failed) {
    body = (
      <EmptyState
        action={
          <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        }
        body={failed}
        icon={<Icons.ChatIcon size={18} />}
        title="Couldn't open the conversation"
      />
    );
  } else if (!hasControl && threads) {
    body = (
      <EmptyState
        body="Talking to a teammate needs the control grant on this device."
        icon={<Icons.ChatIcon size={18} />}
        title="No conversations yet"
      />
    );
  } else {
    body = (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <TeammatePageBar
        actions={
          <>
            <span ref={listTrigger}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setListOpen((o) => !o)}
              >
                Conversations
              </Button>
            </span>
            {hasControl && (
              <Button
                disabled={creating}
                leading={<Icons.ComposeIcon size={12} />}
                size="sm"
                onClick={() => void startFresh()}
              >
                New conversation
              </Button>
            )}
          </>
        }
        page="chat"
        onPage={(page) => showTeammatePage(teammateId, page)}
      />
      {listOpen && (
        <PickerPopover
          placement="below"
          triggerRef={listTrigger}
          width={300}
          onClose={() => setListOpen(false)}
        >
          <TeammateThreadList
            creating={creating}
            selectedId={selectedId}
            threads={(threads ?? []).map((t) => ({
              id: t.id,
              title: t.title,
              lastOpenedLabel: formatRelative(t.last_opened_at),
              surfaceLabel: SURFACE_LABELS[t.surface],
              failed: Boolean(t.failure),
            }))}
            onArchive={hasControl ? (id) => void archive(id) : undefined}
            onNew={hasControl ? () => void startFresh() : undefined}
            onOpen={(id) => {
              setListOpen(false);
              openThread(teammateId, id);
            }}
          />
        </PickerPopover>
      )}
      {body}
      {agentId && failure && (
        <Banner
          className={styles.failure}
          leading={<Icons.WarningIcon size={12} />}
          tone={failure.kind === "limit" ? "warning" : "error"}
          trailing={
            hasControl && (
              <Button
                disabled={resuming}
                size="sm"
                onClick={() => void resume()}
              >
                Resume
              </Button>
            )
          }
        >
          <span className={styles.failureTitle}>
            {threadFailureTitle(failure.kind)}
          </span>
          {threadFailureDetail(failure)}
        </Banner>
      )}
    </>
  );
}
