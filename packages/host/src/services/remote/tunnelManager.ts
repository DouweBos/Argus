/**
 * Manages the child processes that expose the local gateway server to the
 * internet without opening an inbound port — each daemon dials out and proxies
 * back to 127.0.0.1. Argus owns their lifecycle, like it does `conductor`.
 *
 * Providers run concurrently and independently: a phone syncs every reachable
 * address and picks the simplest one, so enabling Tailscale must not tear down
 * Cloudflare. Each provider therefore gets its own child + state.
 *
 * Two providers:
 *   - "cloudflare" (`cloudflared`): "quick" = ephemeral trycloudflare URL (no
 *     account); "token" = stable named tunnel via a connector token + a domain
 *     on Cloudflare.
 *   - "tailscale" (`tailscale funnel`): stable `*.ts.net` URL with no domain and
 *     no Cloudflare account — just the tailscale CLI, logged into a tailnet with
 *     Funnel enabled.
 *
 * Both give a stable-ish public `wss://` URL and only ever see ciphertext (the
 * app layer is Noise-encrypted end to end).
 */

import { spawn, type ChildProcess } from "node:child_process";

export type TunnelProvider = "cloudflare" | "tailscale";
export type CloudflareMode = "quick" | "token";
export type TunnelStatus = "error" | "running" | "starting" | "stopped";

export interface TunnelState {
  status: TunnelStatus;
  /** Public `wss://` URL once known, else null. */
  publicUrl: string | null;
  error: string | null;
}

const STOPPED: TunnelState = {
  status: "stopped",
  publicUrl: null,
  error: null,
};

interface Runtime {
  child: ChildProcess | null;
  state: TunnelState;
}

export const TUNNEL_PROVIDERS: TunnelProvider[] = ["tailscale", "cloudflare"];

const runtimes = new Map<TunnelProvider, Runtime>();
let onChange: (() => void) | null = null;
/** Extra listeners (huddle lifecycle) that must coexist with the status one. */
const changeSubscribers = new Set<() => void>();

function emitChange(): void {
  onChange?.();
  for (const cb of [...changeSubscribers]) {
    cb();
  }
}

function runtimeFor(provider: TunnelProvider): Runtime {
  const existing = runtimes.get(provider);
  if (existing) {
    return existing;
  }
  const fresh: Runtime = { child: null, state: { ...STOPPED } };
  runtimes.set(provider, fresh);

  return fresh;
}

export function getTunnelState(provider: TunnelProvider): TunnelState {
  return runtimes.get(provider)?.state ?? { ...STOPPED };
}

/** Every provider's state, for status reporting. */
export function getTunnelStates(): Record<TunnelProvider, TunnelState> {
  return {
    cloudflare: getTunnelState("cloudflare"),
    tailscale: getTunnelState("tailscale"),
  };
}

export function onTunnelChange(cb: (() => void) | null): void {
  onChange = cb;
}

/** Additional change listener; returns an unsubscribe. */
export function subscribeTunnelChange(cb: () => void): () => void {
  changeSubscribers.add(cb);

  return () => changeSubscribers.delete(cb);
}

function setState(provider: TunnelProvider, next: Partial<TunnelState>): void {
  const rt = runtimeFor(provider);
  rt.state = { ...rt.state, ...next };
  emitChange();
}

function httpsToWss(url: string): string {
  return url
    .replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
}

const CF_QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TS_URL_RE = /https:\/\/[a-z0-9.-]+\.ts\.net/i;

/** Noise that shows up on stderr but never explains a failure. */
const IGNORABLE_OUTPUT_RE = /^\s*(Warning: client version|#|$)/;

/** Last few KB of a child's output, enough to explain why it gave up. */
const OUTPUT_TAIL_LIMIT = 4000;

/**
 * Turn a CLI's dying breath into something a user can act on. Providers report
 * setup problems (missing daemon, logged out, feature disabled) on stderr and
 * then exit, so the exit code alone tells the user nothing.
 */
function describeFailure(
  provider: TunnelProvider,
  bin: string,
  output: string,
  code: number | null,
): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !IGNORABLE_OUTPUT_RE.test(l));
  const joined = lines.join("\n");

  // Tailscale prints the exact admin-console link that fixes each problem.
  const tsLink = /https:\/\/login\.tailscale\.com\/\S+/i.exec(joined)?.[0];

  if (provider === "tailscale") {
    if (
      /is Tailscale running|failed to connect to local Tailscale|tailscaled\.socket|Failed to connect to local Tailscale daemon/i.test(
        joined,
      )
    ) {
      return "Tailscale isn't running. Open the Tailscale app (or start tailscaled), then try again.";
    }
    if (/Funnel is not enabled|Funnel.*not (enabled|available)/i.test(joined)) {
      return tsLink
        ? `Tailscale Funnel isn't enabled on your tailnet. Enable it at ${tsLink}, then try again.`
        : "Tailscale Funnel isn't enabled on your tailnet. Enable Funnel in the Tailscale admin console, then try again.";
    }
    if (/Logged out|Log in at|NeedsLogin|not logged in/i.test(joined)) {
      return tsLink
        ? `Tailscale is logged out. Sign in at ${tsLink}, then try again.`
        : "Tailscale is logged out. Run `tailscale login`, then try again.";
    }
    if (/HTTPS|cert/i.test(joined) && /not enabled|disabled/i.test(joined)) {
      return tsLink
        ? `Tailscale needs HTTPS certificates enabled for your tailnet. Enable them at ${tsLink}, then try again.`
        : "Tailscale needs HTTPS certificates enabled for your tailnet before Funnel works.";
    }
    if (/denied|permission|attribute/i.test(joined)) {
      return `Tailscale denied the Funnel request — check your tailnet's Funnel policy.\n${joined}`;
    }
  }

  if (
    provider === "cloudflare" &&
    /429|rate.?limit|too many (requests|connections)|quota/i.test(joined)
  ) {
    return "Cloudflare is rate-limiting free quick tunnels right now. Wait a minute and try again, or use Tailscale or a named tunnel for a link that doesn't depend on them.";
  }

  if (
    provider === "cloudflare" &&
    /Unauthorized|invalid token|token/i.test(joined) &&
    /fail|error|invalid/i.test(joined)
  ) {
    return `Cloudflare rejected the connector token. Check the token and try again.\n${joined}`;
  }

  if (joined) {
    return joined.length > 600 ? joined.slice(-600) : joined;
  }

  return `${bin} exited (${code ?? "signal"}) without explanation.`;
}

export interface StartTunnelOpts {
  provider: TunnelProvider;
  localPort: number;
  /** Cloudflare sub-mode. */
  cloudflareMode?: CloudflareMode;
  /** Cloudflare connector token (token mode). */
  cloudflareToken?: string;
  /** Stable public URL configured in Cloudflare (token mode). */
  cloudflarePublicUrl?: string;
  /** Override the binary path; defaults to the provider's CLI on PATH. */
  bin?: string;
}

interface Plan {
  bin: string;
  args: string[];
  /** Regex to pull a discovered URL from process output, if any. */
  urlRe: RegExp | null;
  /** Preset URL (cloudflare token mode), else null. */
  presetUrl: string | null;
  /** Output signal that means "up" when no URL is discovered. */
  runningSignal: RegExp | null;
}

function planFor(opts: StartTunnelOpts): Plan {
  const target = `http://localhost:${opts.localPort}`;
  if (opts.provider === "tailscale") {
    return {
      bin: opts.bin ?? "tailscale",
      args: ["funnel", String(opts.localPort)],
      urlRe: TS_URL_RE,
      presetUrl: null,
      runningSignal: null,
    };
  }
  if (opts.cloudflareMode === "token") {
    return {
      bin: opts.bin ?? "cloudflared",
      args: ["tunnel", "run", "--token", opts.cloudflareToken ?? ""],
      urlRe: null,
      presetUrl: opts.cloudflarePublicUrl
        ? httpsToWss(opts.cloudflarePublicUrl)
        : null,
      runningSignal: /Registered tunnel connection|Connection .* registered/i,
    };
  }

  return {
    bin: opts.bin ?? "cloudflared",
    args: ["tunnel", "--no-autoupdate", "--url", target],
    urlRe: CF_QUICK_URL_RE,
    presetUrl: null,
    runningSignal: null,
  };
}

export function startTunnel(opts: StartTunnelOpts): void {
  const { provider } = opts;
  stopTunnel(provider);
  const plan = planFor(opts);

  setState(provider, {
    status: "starting",
    error: null,
    publicUrl: plan.presetUrl,
  });

  let proc: ChildProcess;
  try {
    proc = spawn(plan.bin, plan.args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    setState(provider, {
      status: "error",
      error: `failed to launch ${plan.bin}: ${(e as Error).message}`,
    });

    return;
  }
  const rt = runtimeFor(provider);
  rt.child = proc;

  let tail = "";
  const scan = (buf: Buffer) => {
    const text = buf.toString();
    tail = (tail + text).slice(-OUTPUT_TAIL_LIMIT);
    if (plan.urlRe && !getTunnelState(provider).publicUrl) {
      const match = plan.urlRe.exec(text);
      if (match) {
        setState(provider, {
          status: "running",
          publicUrl: httpsToWss(match[0]),
        });
      }
    } else if (plan.runningSignal?.test(text)) {
      setState(provider, { status: "running" });
    }
  };
  proc.stdout?.on("data", scan);
  proc.stderr?.on("data", scan);

  proc.on("error", (err) => {
    const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
    setState(provider, {
      status: "error",
      error: enoent
        ? `\`${plan.bin}\` isn't on Argus's PATH. Install it (\`brew install ${plan.bin}\`) and restart Argus.`
        : err.message,
    });
  });
  proc.on("exit", (code) => {
    if (rt.child === proc) {
      rt.child = null;
      if (rt.state.status !== "stopped") {
        setState(provider, {
          status: "error",
          error: describeFailure(provider, plan.bin, tail, code),
        });
      }
    }
  });
}

/** Stop one provider, or every running tunnel when none is named. */
export function stopTunnel(provider?: TunnelProvider): void {
  const targets = provider ? [provider] : [...runtimes.keys()];
  for (const target of targets) {
    const rt = runtimes.get(target);
    if (!rt) {
      continue;
    }
    if (rt.child) {
      const proc = rt.child;
      rt.child = null;
      proc.removeAllListeners();
      proc.kill();
      // Escalate to SIGKILL if the daemon ignores SIGTERM, so it can't orphan.
      const kill = setTimeout(() => proc.kill("SIGKILL"), 2000);
      kill.unref();
      proc.once("exit", () => clearTimeout(kill));
    }
    rt.state = { ...STOPPED };
  }
  emitChange();
}
