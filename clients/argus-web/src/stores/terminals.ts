/**
 * A session's terminals, read-only — what a browser shows of a dev server.
 * Typing into one stays with the desktop. Mirrors `HostStore+Terminals`: a
 * followed terminal replays its scrollback, then streams `terminal.data`,
 * stitched by `TerminalFeed` so every byte shows once. A host too old to
 * stream is polled for its plain-text tail instead.
 */

import {
  decodeTerminalBytes,
  describeError,
  TerminalFeed,
  type TerminalLive,
  type TerminalOutput,
} from "@argus/client-core";
import type { TerminalChunk, TerminalStream } from "@argus/peacock";
import type { RemoteTerminal } from "@argus/remote-protocol";
import { create } from "zustand";
import { request, sequencedRequest } from "../lib/request";
import { currentTransport } from "./connection";

interface TerminalsState {
  terminalsBySession: Record<string, RemoteTerminal[]>;
  /** Per session: listed at least once, and the last failure if any. */
  loadBySession: Record<string, { error: string | null; loaded: boolean }>;
  exitByTerminal: Record<string, number>;
  /** True when streaming, false when the host can only be polled. */
  liveByTerminal: Record<string, boolean>;

  refreshTerminals: (sessionId: string) => Promise<void>;
}

export const useTerminalsStore = create<TerminalsState>()((set) => ({
  terminalsBySession: {},
  loadBySession: {},
  exitByTerminal: {},
  liveByTerminal: {},

  refreshTerminals: async (sessionId) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { terminals } = await request(t, "terminals.list", {
        session_id: sessionId,
      });
      set((s) => ({
        terminalsBySession: { ...s.terminalsBySession, [sessionId]: terminals },
        loadBySession: {
          ...s.loadBySession,
          [sessionId]: { loaded: true, error: null },
        },
      }));
    } catch (err) {
      set((s) => ({
        loadBySession: {
          ...s.loadBySession,
          [sessionId]: {
            loaded: s.loadBySession[sessionId]?.loaded ?? false,
            error: describeError(err),
          },
        },
      }));
    }
  },
}));

/** Run commands first, as on the desktop and the phone. */
export function orderedTerminals(terminals: readonly RemoteTerminal[]): RemoteTerminal[] {
  return [
    ...terminals.filter((t) => t.run_title !== null),
    ...terminals.filter((t) => t.run_title === null),
  ];
}

export function terminalTitle(terminal: RemoteTerminal): string {
  return terminal.title ?? terminal.run_title ?? "Shell";
}

/** Older output past this is dropped; the host keeps less than this anyway. */
const BUFFER_LIMIT = 2 * 1024 * 1024;
const POLL_MS = 2000;

type Sink = (chunks: TerminalChunk[]) => void;

/** One followed terminal: its bytes so far and whoever is drawing them. */
class Follower {
  private readonly feed = new TerminalFeed();
  private readonly sinks = new Set<Sink>();
  private chunks: Uint8Array[] = [];
  private size = 0;
  private exitCode: number | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** Bumped per (re)start so a late scrollback can't land on a newer one. */
  private generation = 0;

  constructor(readonly id: string) {}

  get following(): boolean {
    return this.sinks.size > 0;
  }

  add(sink: Sink): void {
    this.sinks.add(sink);
    if (this.sinks.size === 1) {
      void this.start();
    } else {
      sink(this.snapshot());
    }
  }

  remove(sink: Sink): void {
    this.sinks.delete(sink);
    if (this.sinks.size === 0) {
      this.stop();
    }
  }

  live(event: TerminalLive, seq: number): void {
    if (this.following) {
      this.apply(this.feed.live(event, seq));
    }
  }

  /** Replay from scratch: after a reconnect, events in between are lost. */
  async start(): Promise<void> {
    const t = currentTransport();
    if (!t) {
      return;
    }
    this.generation += 1;
    const generation = this.generation;
    this.stopPolling();
    t.subscribe(`terminal:${this.id}`, true);
    this.feed.beginReplay();
    try {
      const { result, seq } = await sequencedRequest(t, "terminals.scrollback", {
        terminal_id: this.id,
      });
      if (generation !== this.generation) {
        return;
      }
      setLive(this.id, true);
      this.apply(
        this.feed.replay(decodeTerminalBytes(result.data), result.exit_code, seq),
      );
    } catch {
      if (generation !== this.generation) {
        return;
      }
      // An older host, or a terminal that's gone: read its tail instead.
      t.subscribe(`terminal:${this.id}`, false);
      setLive(this.id, false);
      void this.read();
      this.poll = setInterval(() => void this.read(), POLL_MS);
    }
  }

  private async read(): Promise<void> {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const out = await request(t, "terminals.read", { terminal_id: this.id }).catch(
      () => null,
    );
    if (!out || !this.following) {
      return;
    }
    const text = out.output.replace(/\r?\n/g, "\r\n");
    const outputs: TerminalOutput[] = [
      { kind: "reset" },
      { kind: "data", data: new TextEncoder().encode(text) },
    ];
    if (!out.running && out.exit_code !== null) {
      outputs.push({ kind: "exit", code: out.exit_code });
      this.stopPolling();
    }
    this.apply(outputs);
  }

  private stopPolling(): void {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  private stop(): void {
    this.generation += 1;
    this.stopPolling();
    currentTransport()?.subscribe(`terminal:${this.id}`, false);
    this.chunks = [];
    this.size = 0;
    this.exitCode = null;
  }

  private snapshot(): TerminalChunk[] {
    const out: TerminalChunk[] = [{ kind: "reset" }];
    for (const data of this.chunks) {
      out.push({ kind: "data", data });
    }
    if (this.exitCode !== null) {
      out.push({ kind: "exit", code: this.exitCode });
    }

    return out;
  }

  private apply(outputs: TerminalOutput[]): void {
    if (outputs.length === 0) {
      return;
    }
    for (const output of outputs) {
      if (output.kind === "reset") {
        this.chunks = [];
        this.size = 0;
        this.exitCode = null;
      } else if (output.kind === "data") {
        this.chunks.push(output.data);
        this.size += output.data.length;
        while (this.size > BUFFER_LIMIT && this.chunks.length > 1) {
          this.size -= this.chunks.shift()?.length ?? 0;
        }
      } else {
        this.exitCode = output.code;
        setExit(this.id, output.code);
      }
    }
    for (const sink of this.sinks) {
      sink(outputs);
    }
  }
}

function setLive(id: string, live: boolean): void {
  useTerminalsStore.setState((s) => ({
    liveByTerminal: { ...s.liveByTerminal, [id]: live },
  }));
}

function setExit(id: string, code: number): void {
  useTerminalsStore.setState((s) => ({
    exitByTerminal: { ...s.exitByTerminal, [id]: code },
  }));
}

const followers = new Map<string, Follower>();
const streams = new Map<string, TerminalStream>();

function follower(id: string): Follower {
  let f = followers.get(id);
  if (!f) {
    f = new Follower(id);
    followers.set(id, f);
  }

  return f;
}

/** A terminal's output for `TerminalView`; following starts with the first viewer. */
export function terminalStream(id: string): TerminalStream {
  let stream = streams.get(id);
  if (!stream) {
    stream = {
      subscribe: (sink) => {
        const f = follower(id);
        f.add(sink);

        return () => f.remove(sink);
      },
    };
    streams.set(id, stream);
  }

  return stream;
}

export function receiveTerminalData(id: string, base64: string, seq: number): void {
  followers.get(id)?.live({ kind: "data", data: decodeTerminalBytes(base64) }, seq);
}

export function receiveTerminalExit(id: string, code: number, seq: number): void {
  followers.get(id)?.live({ kind: "exit", code }, seq);
}

/** A fresh channel: whatever the terminals printed meanwhile reached nobody. */
export function resyncTerminals(): void {
  for (const f of followers.values()) {
    if (f.following) {
      void f.start();
    }
  }
}

export function resetTerminals(): void {
  followers.clear();
  streams.clear();
  useTerminalsStore.setState({
    terminalsBySession: {},
    loadBySession: {},
    exitByTerminal: {},
    liveByTerminal: {},
  });
}
