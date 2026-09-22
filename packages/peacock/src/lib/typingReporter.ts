/**
 * Throttles "I'm typing" presence for a huddle, so a composer can call
 * {@link TypingReporter.keystroke} on every keypress without flooding the wire.
 *
 * Transport-agnostic — the caller supplies `send`, so the desktop reports over
 * IPC and a guest over its Noise socket, both with the same cadence.
 */

/** Renew well inside the host's 8s expiry, so the flag never lapses mid-sentence. */
const RENEW_MS = 4_000;

/** Stop claiming they're typing once the keyboard has been quiet this long. */
const IDLE_MS = 3_000;

export interface TypingReporter {
  /** A key was pressed. Sends `true` on the first one, then renews. */
  keystroke: () => void;
  /** Sent, cleared, or navigated away: drop the flag now. */
  stop: () => void;
  /** Tear down the timers. Does not send — for unmount. */
  dispose: () => void;
}

export function createTypingReporter(
  send: (typing: boolean) => void,
): TypingReporter {
  let typing = false;
  let lastSent = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idle) {
      clearTimeout(idle);
      idle = null;
    }
  };

  const stop = () => {
    clearIdle();
    if (typing) {
      typing = false;
      send(false);
    }
  };

  return {
    keystroke: () => {
      const now = Date.now();
      if (!typing || now - lastSent >= RENEW_MS) {
        typing = true;
        lastSent = now;
        send(true);
      }
      clearIdle();
      idle = setTimeout(stop, IDLE_MS);
    },
    stop,
    dispose: clearIdle,
  };
}
