/**
 * A project's saved chats as a session's history shows them. The TS twin of
 * `HostStore+ChatHistory` in ArgusCore.
 */

import type {
  ChatHistoryEntry,
  ChatHistoryMessageMatch,
  GatewayResult,
  RemoteSession,
  RemoteStoppedAgent,
} from "@argus/remote-protocol";

export type HistorySearchResult =
  GatewayResult<"agents.history_search">["results"][number];
export type HistoryMatch = HistorySearchResult["message_matches"][number];

/** A session's saved chats: the ones on its branch, newest first. */
export function chatsInSession(
  stopped: RemoteStoppedAgent[],
  session: Pick<RemoteSession, "branch">,
): RemoteStoppedAgent[] {
  return stopped
    .filter((c) => c.branch === session.branch)
    .sort((a, b) => b.ended_at - a.ended_at);
}

/** The chats a search shows: titles narrow at once, the host's hits (for `hits.query`) once they arrive. */
export function filterChats(
  chats: RemoteStoppedAgent[],
  query: string,
  hits: { query: string; matches: Record<string, HistoryMatch[]> } | null,
): RemoteStoppedAgent[] {
  const needle = query.trim();
  if (!needle) {
    return chats;
  }
  if (!hits || hits.query !== needle) {
    const lower = needle.toLowerCase();

    return chats.filter((c) => c.title.toLowerCase().includes(lower));
  }

  return chats.filter((c) => hits.matches[c.history_id] !== undefined);
}

/** Search results by history id; the first wins when the host repeats one. */
export function matchesById(
  results: HistorySearchResult[],
): Record<string, HistoryMatch[]> {
  const out: Record<string, HistoryMatch[]> = {};
  for (const r of results) {
    out[r.history_id] ??= r.message_matches;
  }

  return out;
}

/** A gateway saved chat in the shape the shared history list draws. */
export function historyEntry(
  chat: RemoteStoppedAgent,
  sessionId: string,
  sessionDescription = "",
): ChatHistoryEntry {
  return {
    id: chat.history_id,
    title: chat.title,
    sessionId: chat.runner_session_id,
    argusSessionId: sessionId,
    sessionBranch: chat.branch,
    sessionDescription: chat.description ?? sessionDescription,
    createdAt: chat.started_at,
    endedAt: chat.ended_at,
    messageCount: chat.message_count,
    ...(chat.model ? { model: chat.model } : {}),
    ...(chat.imported_from ? { importedFrom: chat.imported_from } : {}),
    ...(chat.runner_id ? { runnerId: chat.runner_id } : {}),
    ...(chat.permission_mode ? { permissionMode: chat.permission_mode } : {}),
    ...(chat.effort ? { effort: chat.effort } : {}),
    ...(chat.pinned ? { pinned: true } : {}),
  };
}

/** A gateway hit in the shape the shared history list draws. */
export function historyMatch(
  match: HistoryMatch,
  messageIndex: number,
): ChatHistoryMessageMatch {
  return {
    role: match.role,
    snippet: match.snippet,
    matchStart: match.match_start,
    matchEnd: match.match_end,
    messageIndex,
  };
}

/** The snippet around its hit, offsets clamped to the text. */
export function snippetParts(
  snippet: string,
  start: number,
  end: number,
): { before: string; hit: string; after: string } {
  const from = Math.min(Math.max(start, 0), snippet.length);
  const to = Math.min(Math.max(end, from), snippet.length);

  return {
    before: snippet.slice(0, from),
    hit: snippet.slice(from, to),
    after: snippet.slice(to),
  };
}
