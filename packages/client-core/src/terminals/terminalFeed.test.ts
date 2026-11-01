import { describe, expect, it } from "vitest";
import { decodeTerminalBytes, TerminalFeed } from "./terminalFeed";

// Vectors shared with ArgusCore's TerminalFeedTests.

const bytes = (text: string) => new TextEncoder().encode(text);

describe("terminalFeed", () => {
  it("holds live output until the replay lands", () => {
    const feed = new TerminalFeed();
    feed.beginReplay();
    expect(feed.live({ kind: "data", data: bytes("a") }, 4)).toEqual([]);
    expect(feed.live({ kind: "data", data: bytes("b") }, 6)).toEqual([]);

    // `a` was sent before the replay's response, so the replay already has it.
    expect(feed.replay(bytes("history a"), null, 5)).toEqual([
      { kind: "reset" },
      { kind: "data", data: bytes("history a") },
      { kind: "data", data: bytes("b") },
    ]);
  });

  it("drops events delivered late but sent before the replay", () => {
    const feed = new TerminalFeed();
    feed.beginReplay();
    feed.replay(bytes("x"), null, 10);
    expect(feed.live({ kind: "data", data: bytes("old") }, 9)).toEqual([]);
    expect(feed.live({ kind: "data", data: bytes("new") }, 11)).toEqual([
      { kind: "data", data: bytes("new") },
    ]);
  });

  it("replays an exited terminal's exit", () => {
    const feed = new TerminalFeed();
    feed.beginReplay();
    expect(feed.replay(new Uint8Array(), 2, 1)).toEqual([
      { kind: "reset" },
      { kind: "exit", code: 2 },
    ]);
  });

  it("decodes base64 PTY bytes, and garbage to nothing", () => {
    expect(new TextDecoder().decode(decodeTerminalBytes(btoa("hi\r\n")))).toBe(
      "hi\r\n",
    );
    expect(decodeTerminalBytes("%%%")).toEqual(new Uint8Array());
  });
});
