/**
 * Which failures are the connection's rather than the request's, and how to
 * say either to a person. Mirrors `HostStore.isTransient` / `describe` in
 * ArgusCore. Duck-typed on `code` so it needs no transport import: the
 * gateway transport rejects with `RemoteError("offline" | "timeout" | …)`.
 */

/** Codes a transport uses when the connection, not the host, failed. */
const TRANSIENT_CODES = new Set(["disconnected", "offline", "timeout"]);

export const NOT_CONNECTED_MESSAGE = "Not connected to a computer.";
export const TIMED_OUT_MESSAGE = "The computer didn't answer in time.";

function codeOf(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error as { code: unknown };

    return typeof code === "string" ? code : null;
  }

  return null;
}

/** The connection was down, dropped mid-call or never answered: retry on the next one. */
export function isTransientError(error: unknown): boolean {
  const code = codeOf(error);

  return code !== null && TRANSIENT_CODES.has(code);
}

/**
 * Nothing to tell anyone: a background refresh (poll, tab resume, reconnect
 * reload) that only lost its connection. The connection badge already says so.
 */
export function isQuietError(error: unknown, background: boolean): boolean {
  return background && isTransientError(error);
}

/** One sentence for a person, matching the phone's wording. */
export function describeError(error: unknown): string {
  const code = codeOf(error);
  if (code === "offline" || code === "disconnected") {
    return NOT_CONNECTED_MESSAGE;
  }
  if (code === "timeout") {
    return TIMED_OUT_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" && error ? error : "Something went wrong.";
}
