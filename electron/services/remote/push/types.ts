/** The result of trying to deliver one push. */
export type PushOutcome =
  | { ok: false; retryable: boolean; reason: string }
  | { ok: true };
