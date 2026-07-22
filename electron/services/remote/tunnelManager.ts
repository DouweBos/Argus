/**
 * Manages the child process that exposes the local gateway server to the
 * internet without opening an inbound port — the daemon dials out and proxies
 * back to 127.0.0.1. Argus owns its lifecycle, like it does `conductor`.
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

let child: ChildProcess | null = null;
let state: TunnelState = { status: "stopped", publicUrl: null, error: null };
let onChange: ((s: TunnelState) => void) | null = null;

export function getTunnelState(): TunnelState {
  return state;
}

export function onTunnelChange(cb: ((s: TunnelState) => void) | null): void {
  onChange = cb;
}

function setState(next: Partial<TunnelState>): void {
  state = { ...state, ...next };
  onChange?.(state);
}

function httpsToWss(url: string): string {
  return url
    .replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
}

const CF_QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TS_URL_RE = /https:\/\/[a-z0-9.-]+\.ts\.net/i;

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
  stopTunnel();
  const plan = planFor(opts);

  setState({ status: "starting", error: null, publicUrl: plan.presetUrl });

  let proc: ChildProcess;
  try {
    proc = spawn(plan.bin, plan.args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    setState({
      status: "error",
      error: `failed to launch ${plan.bin}: ${(e as Error).message}`,
    });

    return;
  }
  child = proc;

  const scan = (buf: Buffer) => {
    const text = buf.toString();
    if (plan.urlRe && !state.publicUrl) {
      const match = plan.urlRe.exec(text);
      if (match) {
        setState({ status: "running", publicUrl: httpsToWss(match[0]) });
      }
    } else if (plan.runningSignal?.test(text)) {
      setState({ status: "running" });
    }
  };
  proc.stdout?.on("data", scan);
  proc.stderr?.on("data", scan);

  proc.on("error", (err) => setState({ status: "error", error: err.message }));
  proc.on("exit", (code) => {
    if (child === proc) {
      child = null;
      if (state.status !== "stopped") {
        setState({
          status: "error",
          error: `${plan.bin} exited (${code ?? "signal"})`,
        });
      }
    }
  });
}

export function stopTunnel(): void {
  if (child) {
    const proc = child;
    child = null;
    proc.removeAllListeners();
    proc.kill();
    // Escalate to SIGKILL if the daemon ignores SIGTERM, so it can't orphan.
    const kill = setTimeout(() => proc.kill("SIGKILL"), 2000);
    kill.unref();
    proc.once("exit", () => clearTimeout(kill));
  }
  state = { status: "stopped", publicUrl: null, error: null };
  onChange?.(state);
}
