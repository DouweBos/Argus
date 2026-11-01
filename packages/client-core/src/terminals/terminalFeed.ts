/**
 * Stitches a terminal's replayed scrollback onto its live `terminal.data`
 * events, so a view that (re)attaches shows every byte exactly once. Live
 * events are held until the replay lands; the replay's response `seq` splits
 * them, since anything sequenced before it is already in the replay. The TS
 * twin of ArgusCore's `TerminalFeed`.
 */

export type TerminalOutput =
  /** Start over: the view's contents are about to be replayed. */
  | { kind: "data"; data: Uint8Array }
  | { kind: "exit"; code: number }
  | { kind: "reset" };

export type TerminalLive =
  | { kind: "data"; data: Uint8Array }
  | { kind: "exit"; code: number };

export class TerminalFeed {
  /** Null while a replay is in flight. */
  private replaySeq: number | null = null;
  private held: { seq: number; event: TerminalLive }[] = [];

  get awaitingReplay(): boolean {
    return this.replaySeq === null;
  }

  /** A replay is about to be requested; hold live events until it lands. */
  beginReplay(): void {
    this.replaySeq = null;
    this.held = [];
  }

  live(event: TerminalLive, seq: number): TerminalOutput[] {
    if (this.replaySeq === null) {
      this.held.push({ seq, event });

      return [];
    }

    // Delivered late, but sent before the replay: already shown.
    return seq > this.replaySeq ? [event] : [];
  }

  replay(
    data: Uint8Array,
    exitCode: number | null,
    seq: number,
  ): TerminalOutput[] {
    const replaySeq = seq;
    this.replaySeq = replaySeq;
    const out: TerminalOutput[] = [{ kind: "reset" }];
    if (data.length > 0) {
      out.push({ kind: "data", data });
    }
    if (exitCode !== null) {
      out.push({ kind: "exit", code: exitCode });
    }
    const later = this.held
      .filter((h) => h.seq > replaySeq)
      .map((h) => h.event);
    this.held = [];

    return [...out, ...later];
  }
}

/** `terminal.data` and `terminals.scrollback` carry base64 PTY bytes. */
export function decodeTerminalBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  } catch {
    return new Uint8Array();
  }
}
