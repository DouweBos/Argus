/**
 * Frontend mirror of `packages/host/src/services/remote/shareError.ts`.
 *
 * Share failures arrive as an IPC error carrying the `__shareError` envelope;
 * `invoke` rehydrates them into a `ShareError` so the dialog can walk the user
 * through the fix instead of printing a sentence.
 */

export type ShareErrorKind =
  | "cloudflared-missing"
  | "quick-tunnel-failed"
  | "tailscale-not-ready"
  | "tunnel-unreachable"
  | "unknown";

export interface ShareErrorPayload {
  __shareError: true;
  alternative?: string;
  command?: string;
  detail?: string;
  explanation: string;
  kind: ShareErrorKind;
  message: string;
  steps: string[];
}

export class ShareError extends Error {
  public readonly kind: ShareErrorKind;
  public readonly explanation: string;
  public readonly steps: string[];
  public readonly command?: string;
  public readonly alternative?: string;
  public readonly detail?: string;

  constructor(payload: Omit<ShareErrorPayload, "__shareError">) {
    super(payload.message);
    this.name = "ShareError";
    this.kind = payload.kind;
    this.explanation = payload.explanation;
    this.steps = payload.steps;
    this.command = payload.command;
    this.alternative = payload.alternative;
    this.detail = payload.detail;
  }
}

/** Rebuild a typed `ShareError` from a thrown IPC value, if it is one. */
export function rehydrateShareError(err: unknown): ShareError | null {
  if (err instanceof ShareError) {
    return err;
  }
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const e = err as Record<string, unknown>;
  if (e.__shareError !== true || typeof e.kind !== "string") {
    return null;
  }

  return new ShareError({
    kind: e.kind as ShareErrorKind,
    message: typeof e.message === "string" ? e.message : "Sharing failed",
    explanation: typeof e.explanation === "string" ? e.explanation : "",
    steps: Array.isArray(e.steps) ? (e.steps as string[]) : [],
    command: typeof e.command === "string" ? e.command : undefined,
    alternative: typeof e.alternative === "string" ? e.alternative : undefined,
    detail: typeof e.detail === "string" ? e.detail : undefined,
  });
}

/** Electron wraps every rejection; the user only wants what the host said. */
export function unwrapIpcMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");

  return (
    raw
      .replace(/^Error invoking remote method '[^']+':\s*/, "")
      .replace(/^Error:\s*/, "")
      .trim() || "Sharing failed."
  );
}

/** Anything unexpected, dressed as guidance so the dialog stays one shape. */
export function genericShareError(err: unknown): ShareError {
  return new ShareError({
    kind: "unknown",
    message: "Couldn't start sharing",
    explanation:
      "Argus couldn't get a link for this agent. The details below are what " +
      "the sharing layer reported.",
    steps: [
      "Try again.",
      "If it keeps happening, check Settings → Remote access.",
    ],
    detail: unwrapIpcMessage(err),
  });
}
