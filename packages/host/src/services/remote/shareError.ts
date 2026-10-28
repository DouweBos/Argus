/**
 * Typed share failures.
 *
 * Sharing fails for a handful of knowable reasons — a missing CLI, a tunnel
 * that never came up, a URL that doesn't route back. Each one has a different
 * fix, so they cross IPC as a structured payload the dialog can walk the user
 * through instead of a paragraph of prose in a red box.
 */

export type ShareErrorKind =
  | "cloudflared-missing"
  | "quick-tunnel-failed"
  | "tunnel-unreachable"
  | "unknown";

export interface ShareErrorPayload {
  __shareError: true;
  kind: ShareErrorKind;
  /** One line: what didn't happen. */
  message: string;
  /** Why, in plain language. */
  explanation: string;
  /** What to do, in order. */
  steps: string[];
  /** Shell command that fixes it, if one does. */
  command?: string;
  /** The other way out, when there is one. */
  alternative?: string;
  /** Raw failure text, for the collapsed details. */
  detail?: string;
}

export class ShareError extends Error {
  public readonly kind: ShareErrorKind;
  public readonly explanation: string;
  public readonly steps: string[];
  public readonly command?: string;
  public readonly alternative?: string;
  public readonly detail?: string;

  constructor(
    kind: ShareErrorKind,
    message: string,
    options: {
      explanation: string;
      steps: string[];
      command?: string;
      alternative?: string;
      detail?: string;
    },
  ) {
    super(message);
    this.name = "ShareError";
    this.kind = kind;
    this.explanation = options.explanation;
    this.steps = options.steps;
    this.command = options.command;
    this.alternative = options.alternative;
    this.detail = options.detail;
  }

  toPayload(): ShareErrorPayload {
    return {
      __shareError: true,
      kind: this.kind,
      message: this.message,
      explanation: this.explanation,
      steps: this.steps,
      ...(this.command !== undefined && { command: this.command }),
      ...(this.alternative !== undefined && { alternative: this.alternative }),
      ...(this.detail !== undefined && { detail: this.detail }),
    };
  }
}

/** Type-guard for ShareError payloads received from IPC. */
export function isShareErrorPayload(
  value: unknown,
): value is ShareErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __shareError?: unknown }).__shareError === true
  );
}

const ACCOUNT_ALTERNATIVE =
  "Sign in to an account under Settings → Account and this computer gets a " +
  "tunnel of its own, which sharing uses instead.";

/** `cloudflared` couldn't be installed, and nothing else can carry the link. */
export function cloudflaredMissingError(detail?: string): ShareError {
  return new ShareError(
    "cloudflared-missing",
    "Argus couldn't set up cloudflared to hand out a share link",
    {
      explanation:
        "A guest opens the link from outside your network, so Argus needs a way " +
        "in that doesn't mean opening a port. It uses Cloudflare's free quick " +
        "tunnel for that, through the `cloudflared` command, which Argus " +
        "downloads the first time it's needed — and that download didn't work.",
      steps: [
        "Check this computer's internet connection.",
        "Try sharing again.",
        "Still stuck? Install it yourself with the command below and restart Argus.",
      ],
      command: "brew install cloudflared",
      alternative: ACCOUNT_ALTERNATIVE,
      detail,
    },
  );
}

/** cloudflared is there, but no usable URL came out of the attempt. */
export function quickTunnelError(detail: string): ShareError {
  return new ShareError("quick-tunnel-failed", "Couldn't get a public link", {
    explanation:
      "Cloudflare hands out its free quick tunnels on a best-effort basis — it " +
      "rate-limits them and rotates them out, so one can fail to come up even " +
      "though nothing is wrong on this Mac.",
    steps: [
      "Wait a minute, then try again.",
      "If it keeps failing, sign in to an account under Settings → Account: this computer then gets a tunnel of its own that doesn't depend on quick tunnels.",
    ],
    detail,
  });
}
