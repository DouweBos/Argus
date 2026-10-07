/**
 * Following an agent's conversation from the host that folds it: fetch the
 * newest page, then apply each `agent:transcript:<id>` delta. A delta that
 * doesn't follow (a gap, a new epoch, a reconnect) refetches the page; one
 * that arrives while a page is in flight waits for it.
 */

import type { AgentConversation } from "@argus/host/services/agent/conversation/types";
import type { AgentTranscriptDelta } from "@argus/remote-protocol";
import {
  applyTranscriptDelta,
  applyTranscriptPage,
  getConversationState,
  prependTranscriptPage,
  setStaticConversation,
} from "../stores/conversationStore";
import { type UnlistenFn, listen } from "./events";
import { getAgentSnapshot, getAgentTranscript } from "./ipc";
import { capture } from "./telemetry";

/** Newest messages a chat opens on; older ones load as the user scrolls up. */
export const TRANSCRIPT_PAGE = 100;
/** An older host has no deltas: re-read its snapshot this long after activity. */
const LEGACY_REFETCH_MS = 300;

interface Follow {
  buffered: AgentTranscriptDelta[];
  fetching: boolean;
  /** The host predates deltas; read its snapshot instead. */
  legacy: boolean;
  legacyTimer?: ReturnType<typeof setTimeout>;
  refetchAgain: boolean;
  unlisten: UnlistenFn[];
  users: number;
}

const follows = new Map<string, Follow>();

/** Follow an agent's conversation until the returned function is called. */
export function followTranscript(agentId: string): () => void {
  let follow = follows.get(agentId);
  if (!follow) {
    follow = {
      buffered: [],
      fetching: false,
      legacy: false,
      refetchAgain: false,
      unlisten: [],
      users: 0,
    };
    follows.set(agentId, follow);
    const f = follow;
    listen<AgentTranscriptDelta>(`agent:transcript:${agentId}`, (e) =>
      onDelta(agentId, f, e.payload),
    ).then((u) => keep(agentId, f, u));
    listen<string>(`agent:event:${agentId}`, () => {
      if (f.legacy) {
        scheduleLegacyRefetch(agentId, f);
      }
    }).then((u) => keep(agentId, f, u));
    refetch(agentId).catch(() => {});
  }
  follow.users += 1;
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    const f = follows.get(agentId);
    if (f && --f.users === 0) {
      follows.delete(agentId);
      clearTimeout(f.legacyTimer);
      f.unlisten.forEach((u) => u());
    }
  };
}

function keep(agentId: string, follow: Follow, unlisten: UnlistenFn): void {
  if (follows.get(agentId) === follow) {
    follow.unlisten.push(unlisten);
  } else {
    unlisten();
  }
}

function onDelta(
  agentId: string,
  follow: Follow,
  delta: AgentTranscriptDelta,
): void {
  if (follow.fetching) {
    follow.buffered.push(delta);

    return;
  }
  if (applyTranscriptDelta(agentId, delta) === "gap") {
    const window = getConversationState().windows[agentId];
    if (window) {
      capture("agent_transcript_resynced", {
        new_epoch: window.epoch !== delta.epoch,
      });
    }
    refetch(agentId).catch(() => {});
  }
}

/** Load the newest page again, then replay what arrived meanwhile. */
export async function refetch(agentId: string): Promise<void> {
  const follow = follows.get(agentId);
  if (!follow) {
    return;
  }
  if (follow.fetching) {
    follow.refetchAgain = true;

    return;
  }
  if (follow.legacy) {
    await loadLegacySnapshot(agentId);

    return;
  }
  follow.fetching = true;
  follow.buffered = [];
  try {
    const page = await getAgentTranscript(agentId, { limit: TRANSCRIPT_PAGE });
    if (follows.get(agentId) !== follow) {
      return;
    }
    if (page) {
      applyTranscriptPage(agentId, page);
    }
  } catch (e) {
    if (isUnknownCommand(e)) {
      follow.legacy = true;
      follow.fetching = false;
      await loadLegacySnapshot(agentId);

      return;
    }
  } finally {
    follow.fetching = false;
  }
  const buffered = follow.buffered;
  follow.buffered = [];
  let gap = false;
  for (const delta of buffered) {
    gap = applyTranscriptDelta(agentId, delta) === "gap" || gap;
  }
  if (gap || follow.refetchAgain) {
    follow.refetchAgain = false;
    refetch(agentId).catch(() => {});
  }
}

/** Load the page before the oldest loaded message. False when there is none. */
export async function loadOlderTranscript(agentId: string): Promise<boolean> {
  const window = getConversationState().windows[agentId];
  if (!window || window.start === 0) {
    return false;
  }
  const page = await getAgentTranscript(agentId, {
    before: window.start,
    limit: TRANSCRIPT_PAGE,
  }).catch(() => null);
  const ok = page !== null && prependTranscriptPage(agentId, page);
  capture("agent_transcript_paged", { success: ok });
  if (!ok) {
    refetch(agentId).catch(() => {});
  }

  return ok;
}

function isUnknownCommand(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);

  return /unknown (command|method)/i.test(message);
}

function scheduleLegacyRefetch(agentId: string, follow: Follow): void {
  clearTimeout(follow.legacyTimer);
  follow.legacyTimer = setTimeout(() => {
    loadLegacySnapshot(agentId).catch(() => {});
  }, LEGACY_REFETCH_MS);
}

async function loadLegacySnapshot(agentId: string): Promise<void> {
  try {
    const raw = await getAgentSnapshot(agentId);
    if (raw && follows.has(agentId)) {
      setStaticConversation(agentId, JSON.parse(raw) as AgentConversation);
    }
  } catch {
    // Nothing published yet; the next event tries again.
  }
}

/** Test-only. */
export function resetTranscriptFollows(): void {
  for (const follow of follows.values()) {
    clearTimeout(follow.legacyTimer);
    follow.unlisten.forEach((u) => u());
  }
  follows.clear();
}
