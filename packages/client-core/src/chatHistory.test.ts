import type { RemoteStoppedAgent } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  chatsInSession,
  filterChats,
  historyEntry,
  matchesById,
  snippetParts,
} from "./chatHistory";

const chat = (
  id: string,
  title: string,
  branch = "main",
  endedAt = 1,
): RemoteStoppedAgent => ({
  history_id: id,
  runner_session_id: `r-${id}`,
  title,
  branch,
  message_count: 3,
  started_at: 0,
  ended_at: endedAt,
});

describe("chat history", () => {
  it("lists a session's own chats, newest first", () => {
    const chats = [
      chat("a", "A", "main", 1),
      chat("b", "B", "other"),
      chat("c", "C", "main", 5),
    ];
    expect(
      chatsInSession(chats, { branch: "main" }).map((c) => c.history_id),
    ).toEqual(["c", "a"]);
  });

  it("narrows by title until the host's hits for the query arrive", () => {
    const chats = [chat("a", "Fix login"), chat("b", "Refactor")];
    expect(filterChats(chats, "", null)).toBe(chats);
    expect(
      filterChats(chats, " login ", null).map((c) => c.history_id),
    ).toEqual(["a"]);
    const hits = { query: "login", matches: { b: [] } };
    expect(filterChats(chats, "login", hits).map((c) => c.history_id)).toEqual([
      "b",
    ]);
    expect(filterChats(chats, "refac", hits).map((c) => c.history_id)).toEqual([
      "b",
    ]);
  });

  it("keeps the first result per chat", () => {
    const match = {
      role: "user" as const,
      snippet: "x",
      match_start: 0,
      match_end: 1,
    };
    expect(
      matchesById([
        { history_id: "a", message_matches: [match] },
        { history_id: "a", message_matches: [] },
      ]),
    ).toEqual({ a: [match] });
  });

  it("maps a saved chat onto a history entry", () => {
    const entry = historyEntry({ ...chat("a", "A"), pinned: true }, "s1");
    expect(entry).toMatchObject({
      id: "a",
      sessionId: "r-a",
      argusSessionId: "s1",
      sessionBranch: "main",
      pinned: true,
    });
  });

  it("clamps a snippet's hit to its text", () => {
    expect(snippetParts("hello world", 6, 11)).toEqual({
      before: "hello ",
      hit: "world",
      after: "",
    });
    expect(snippetParts("abc", 2, 99)).toEqual({
      before: "ab",
      hit: "c",
      after: "",
    });
    expect(snippetParts("abc", -3, 1)).toEqual({
      before: "",
      hit: "a",
      after: "bc",
    });
  });
});
