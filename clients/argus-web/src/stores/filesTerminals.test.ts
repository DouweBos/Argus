// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import type { TerminalChunk } from "@argus/peacock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "./connection";
import { useFileSearchStore } from "./fileSearch";
import { resetHostStores, resyncAfterReconnect, routeEvent } from "./hostSync";
import { orderedTerminals, terminalStream, useTerminalsStore } from "./terminals";

type Handler = (params: Record<string, unknown>) => unknown;

function fakeTransport(
  handlers: Record<string, Handler>,
  seqs: Record<string, number> = {},
) {
  const calls: string[] = [];
  const answer = async (method: string, params: Record<string, unknown>) => {
    calls.push(method);
    const handler = handlers[method];
    if (!handler) {
      throw Object.assign(new Error(`no ${method}`), { code: "not_found" });
    }

    return handler(params);
  };
  const transport = {
    request: vi.fn(answer),
    sequencedRequest: vi.fn(
      async (method: string, params: Record<string, unknown>) => ({
        result: await answer(method, params),
        seq: seqs[method] ?? 0,
      }),
    ),
    subscribe: vi.fn(),
    disconnect: vi.fn(),
  };
  useConnectionStore.setState({
    transport: transport as unknown as Transport,
    connection: "ready",
  });

  return { transport, calls };
}

function event(name: string, payload: unknown, seq = 1) {
  return { type: "evt" as const, seq, event: name, payload };
}

const b64 = (text: string) => btoa(text);
const text = (chunks: TerminalChunk[]) =>
  chunks
    .map((c) =>
      c.kind === "data"
        ? typeof c.data === "string"
          ? c.data
          : new TextDecoder().decode(c.data)
        : `<${c.kind}>`,
    )
    .join("");

beforeEach(() => {
  resetHostStores();
});

afterEach(() => {
  useConnectionStore.setState({ transport: null, connection: "offline" });
});

describe("file search", () => {
  it("subscribes, streams matches grouped by file and stops listening when done", async () => {
    const { transport } = fakeTransport({
      "files.search": (p) => ({ search_id: p.search_id }),
    });
    const store = useFileSearchStore.getState();
    store.setQuery("s1", "needle");
    await store.run("s1");

    const { results } = useFileSearchStore.getState().bySession.s1;
    const searchId = results.searchId ?? "";
    expect(results.phase.kind).toBe("running");
    expect(transport.subscribe).toHaveBeenCalledWith(
      `code-search:${searchId}`,
      true,
    );

    const match = (relativePath: string, line: number) => ({
      relativePath,
      line,
      column: 0,
      length: 6,
      preview: "needle",
      previewOffset: 0,
    });
    routeEvent(
      event("files.search", {
        kind: "matches",
        searchId,
        matches: [match("a.ts", 1), match("b.ts", 2), match("a.ts", 3)],
      }),
    );
    routeEvent(
      event("files.search", {
        kind: "done",
        searchId,
        count: 3,
        truncated: false,
        cancelled: false,
      }),
    );

    const done = useFileSearchStore.getState().bySession.s1.results;
    expect(done.groups.map((g) => g.path)).toEqual(["a.ts", "b.ts"]);
    expect(done.phase).toEqual({ kind: "done", count: 3, truncated: false });
    expect(transport.subscribe).toHaveBeenLastCalledWith(
      `code-search:${searchId}`,
      false,
    );
  });

  it("cancels the running search before starting the next", async () => {
    const { calls } = fakeTransport({
      "files.search": (p) => ({ search_id: p.search_id }),
      "files.search_cancel": () => ({ accepted: true }),
    });
    const store = useFileSearchStore.getState();
    store.setQuery("s1", "one");
    await store.run("s1");
    store.setQuery("s1", "two");
    await store.run("s1");

    expect(calls).toEqual(["files.search", "files.search_cancel", "files.search"]);
  });
});

describe("terminals", () => {
  it("replays scrollback, then streams only what came after it", async () => {
    const { transport } = fakeTransport(
      {
        "terminals.scrollback": () => ({
          data: b64("$ pnpm dev\r\n"),
          truncated: false,
          exit_code: null,
        }),
      },
      { "terminals.scrollback": 5 },
    );
    const seen: TerminalChunk[] = [];
    const stop = terminalStream("t1").subscribe((chunks) => seen.push(...chunks));
    // Sent before the replay answered: already in it.
    routeEvent(event("terminal.data", { terminal_id: "t1", data: b64("old") }, 4));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    routeEvent(event("terminal.data", { terminal_id: "t1", data: b64("ready") }, 6));
    routeEvent(event("terminal.exit", { terminal_id: "t1", exit_code: 0 }, 7));

    expect(text(seen)).toBe("<reset>$ pnpm dev\r\nready<exit>");
    expect(useTerminalsStore.getState().liveByTerminal.t1).toBe(true);
    expect(useTerminalsStore.getState().exitByTerminal.t1).toBe(0);
    expect(transport.subscribe).toHaveBeenCalledWith("terminal:t1", true);

    // A second viewer gets everything so far in one go.
    const late: TerminalChunk[] = [];
    const stopLate = terminalStream("t1").subscribe((c) => late.push(...c));
    expect(text(late)).toBe("<reset>$ pnpm dev\r\nready<exit>");

    stopLate();
    stop();
    expect(transport.subscribe).toHaveBeenLastCalledWith("terminal:t1", false);
  });

  it("replays again after a reconnect", async () => {
    let n = 0;
    fakeTransport({
      "terminals.scrollback": () => {
        n += 1;

        return { data: b64(`take ${n}`), truncated: false, exit_code: null };
      },
    });
    const seen: TerminalChunk[] = [];
    const stop = terminalStream("t1").subscribe((c) => seen.push(...c));
    await vi.waitFor(() => expect(text(seen)).toBe("<reset>take 1"));

    resyncAfterReconnect();
    await vi.waitFor(() => expect(text(seen)).toBe("<reset>take 1<reset>take 2"));
    stop();
  });

  it("polls the plain-text tail when the computer can't stream", async () => {
    fakeTransport({
      "terminals.read": () => ({
        output: "built\nok",
        running: false,
        exit_code: 1,
        truncated: false,
      }),
    });
    const seen: TerminalChunk[] = [];
    const stop = terminalStream("t1").subscribe((c) => seen.push(...c));
    await vi.waitFor(() => expect(text(seen)).toBe("<reset>built\r\nok<exit>"));
    expect(useTerminalsStore.getState().liveByTerminal.t1).toBe(false);
    stop();
  });

  it("lists a session's terminals and runs them first in the tabs", async () => {
    fakeTransport({
      "terminals.list": () => ({
        terminals: [
          { id: "sh", title: "Shell 1", run_title: null },
          { id: "run", title: null, run_title: "Dev server" },
        ],
      }),
    });
    await useTerminalsStore.getState().refreshTerminals("s1");
    const { terminalsBySession, loadBySession } = useTerminalsStore.getState();
    expect(terminalsBySession.s1.map((t) => t.id)).toEqual(["sh", "run"]);
    expect(orderedTerminals(terminalsBySession.s1).map((t) => t.id)).toEqual([
      "run",
      "sh",
    ]);
    expect(loadBySession.s1).toEqual({ loaded: true, error: null });
  });
});
