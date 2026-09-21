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
  | "tailscale-not-ready"
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

const TAILSCALE_ALTERNATIVE =
  "Already on Tailscale? Turn it on under Settings → Remote access and sharing " +
  "uses your tailnet instead — no cloudflared needed.";

/** `cloudflared` isn't installed, and nothing else can carry the link. */
export function cloudflaredMissingError(detail?: string): ShareError {
  return new ShareError(
    "cloudflared-missing",
    "Argus needs cloudflared to hand out a share link",
    {
      explanation:
        "A guest opens the link from outside your network, so Argus needs a way " +
        "in that doesn't mean opening a port. It uses Cloudflare's free quick " +
        "tunnel for that, which runs through the `cloudflared` command — and " +
        "that command isn't installed on this Mac.",
      steps: [
        "Run the command below in a terminal.",
        "Quit and reopen Argus so it picks the command up.",
        "Come back here and start sharing.",
      ],
      command: "brew install cloudflared",
      alternative: TAILSCALE_ALTERNATIVE,
      detail,
    },
  );
}

/** What each Tailscale prerequisite means when it's the one in the way. */
const TAILSCALE_BLOCKER_TITLES: Record<string, string> = {
  cli: "Tailscale isn't installed on this Mac",
  daemon: "Tailscale isn't running",
  login: "Tailscale isn't signed in",
  funnel: "Funnel isn't enabled on your tailnet",
};

/**
 * Tailscale is the only way out but isn't ready. Its prerequisites are ordered,
 * so only the first failing one is worth putting in front of anyone — the rest
 * can't be judged until it passes.
 */
export function tailscaleNotReadyError(
  blockingStep: { id: string; message: string },
  detail?: string,
): ShareError {
  return new ShareError(
    "tailscale-not-ready",
    TAILSCALE_BLOCKER_TITLES[blockingStep.id] ??
      "Tailscale can't carry a share link yet",
    {
      explanation:
        "Sharing goes out over your tailnet, which needs Tailscale installed, " +
        "running, signed in, and allowed to use Funnel. " +
        blockingStep.message,
      steps: [
        "Open Settings → Remote access — Argus checks each step there and can fix most of them for you.",
        "Once every check passes, come back and start sharing.",
      ],
      alternative:
        "Rather not use Tailscale? Install Cloudflare's tunnel instead with " +
        "`brew install cloudflared` and restart Argus.",
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
      "If it keeps failing, set up Tailscale or a named Cloudflare tunnel under Settings → Remote access for a link that doesn't depend on quick tunnels.",
    ],
    detail,
  });
}
