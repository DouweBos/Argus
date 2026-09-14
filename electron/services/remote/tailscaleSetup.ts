/**
 * Detects and repairs the Tailscale prerequisites for Funnel, so the Remote
 * access settings can walk a user from "nothing installed" to a working tunnel
 * instead of just reporting `error`.
 *
 * Four ordered checks — each one is meaningless until the previous passes:
 *   cli     → the `tailscale` binary exists somewhere we can run it
 *   daemon  → tailscaled/the macOS app is running and answering the local API
 *   login   → the node is signed into a tailnet (`BackendState: Running`)
 *   funnel  → the tailnet grants this node the Funnel capability
 *
 * `BackendState` and the node's capability map are the authoritative signals;
 * probing with `tailscale funnel <port>` would start a real tunnel.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Enabling Funnel grants the bare `funnel` node attribute; the tailnet may also
 * send the longer `cap/funnel…` URL keys (e.g. `funnel-ports?ports=443,…`).
 * Any of them means Funnel is allowed, so match the attribute and the prefix.
 */
const FUNNEL_ATTR = "funnel";
const FUNNEL_CAP_PREFIX = "https://tailscale.com/cap/funnel";

/** The macOS app ships its own CLI; it's the fallback when PATH has none. */
const MAC_APP_BIN = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const MAC_APP = "/Applications/Tailscale.app";

const FALLBACK_BINS = [
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  MAC_APP_BIN,
];

export type TailscaleStepId = "cli" | "daemon" | "funnel" | "login";
export type TailscaleStepState = "blocked" | "fail" | "ok";

/** A fix Argus can perform itself, on an explicit click. */
export type TailscaleFixKind =
  | "install-cli"
  | "open-url"
  | "sign-in"
  | "start-daemon";

export interface TailscaleStep {
  id: TailscaleStepId;
  title: string;
  state: TailscaleStepState;
  /** One-line, user-facing summary of the current state. */
  message: string;
  /** Raw CLI output, shown behind "Why" when something failed. */
  detail: string | null;
  /** The in-app fix, when there is one. */
  fix: TailscaleFixKind | null;
  fixLabel: string | null;
  /** Page to open for fixes the user must complete in a browser. */
  url: string | null;
}

export interface TailscaleDiagnosis {
  steps: TailscaleStep[];
  /** True when every check passed — Funnel will start. */
  ready: boolean;
  /** Resolved binary, or null when nothing is installed. */
  bin: string | null;
  /** `*.ts.net` name of this node once known. */
  dnsName: string | null;
}

/** Cached so repeated diagnoses don't re-stat the filesystem. */
let cachedBin: string | null = null;

/**
 * Locate a runnable `tailscale`. PATH first (Homebrew, mise, …), then the
 * well-known install locations, since a packaged .app may still miss them.
 */
export async function resolveTailscaleBin(): Promise<string | null> {
  if (cachedBin && existsSync(cachedBin)) {
    return cachedBin;
  }
  try {
    const { stdout } = await exec("which", ["tailscale"]);
    const found = stdout.trim().split("\n")[0];
    if (found && existsSync(found)) {
      cachedBin = found;

      return found;
    }
  } catch {
    // Not on PATH — fall through to the known locations.
  }
  const fallback = FALLBACK_BINS.find((p) => existsSync(p)) ?? null;
  cachedBin = fallback;

  return fallback;
}

interface StatusJson {
  BackendState?: string;
  MagicDNSSuffix?: string;
  Self?: {
    CapMap?: Record<string, unknown>;
    Capabilities?: string[];
    DNSName?: string;
    ID?: string;
  };
}

interface StatusProbe {
  json: StatusJson | null;
  /** Combined stdout+stderr, for the "Why" detail. */
  output: string;
}

/**
 * Ask the local API for status. A non-zero exit or unparseable output means
 * the daemon isn't reachable; a parsed body always carries `BackendState`.
 */
async function probeStatus(bin: string): Promise<StatusProbe> {
  try {
    const { stderr, stdout } = await exec(bin, ["status", "--json"], {
      timeout: 10_000,
    });

    return { json: JSON.parse(stdout) as StatusJson, output: stderr.trim() };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    const output = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    // `status --json` can succeed on stdout while warning on stderr.
    if (err.stdout) {
      try {
        return { json: JSON.parse(err.stdout) as StatusJson, output };
      } catch {
        // Genuinely not JSON.
      }
    }

    return { json: null, output };
  }
}

function grantsFunnel(key: string): boolean {
  return key === FUNNEL_ATTR || key.startsWith(FUNNEL_CAP_PREFIX);
}

function hasFunnelCap(node: StatusJson["Self"]): boolean {
  if (!node) {
    return false;
  }

  return (
    Object.keys(node.CapMap ?? {}).some(grantsFunnel) ||
    (node.Capabilities ?? []).some(grantsFunnel)
  );
}

/** Admin page that toggles Funnel for this specific node. */
function funnelEnableUrl(node: StatusJson["Self"]): string {
  return node?.ID
    ? `https://login.tailscale.com/f/funnel?node=${node.ID}`
    : "https://login.tailscale.com/admin/settings/funnel";
}

/** A step that can't be evaluated yet because an earlier one failed. */
function blocked(id: TailscaleStepId, title: string): TailscaleStep {
  return {
    id,
    title,
    state: "blocked",
    message: "Waiting on the step above.",
    detail: null,
    fix: null,
    fixLabel: null,
    url: null,
  };
}

const BREW_HINT =
  "Homebrew isn't installed, so Argus can't install the CLI for you. Install Tailscale from tailscale.com/download, then re-check.";

async function hasBrew(): Promise<boolean> {
  try {
    await exec("which", ["brew"]);

    return true;
  } catch {
    return false;
  }
}

export async function diagnoseTailscale(): Promise<TailscaleDiagnosis> {
  const bin = await resolveTailscaleBin();

  if (!bin) {
    const brew = await hasBrew();

    return {
      bin: null,
      dnsName: null,
      ready: false,
      steps: [
        {
          id: "cli",
          title: "Tailscale CLI",
          state: "fail",
          message: brew
            ? "Not installed. Argus can install it with Homebrew."
            : BREW_HINT,
          detail: `Looked on PATH and in:\n${FALLBACK_BINS.join("\n")}`,
          fix: brew ? "install-cli" : "open-url",
          fixLabel: brew ? "Install" : "Open download page",
          url: brew ? null : "https://tailscale.com/download/mac",
        },
        blocked("daemon", "Tailscale running"),
        blocked("login", "Signed in"),
        blocked("funnel", "Funnel enabled"),
      ],
    };
  }

  const cliStep: TailscaleStep = {
    id: "cli",
    title: "Tailscale CLI",
    state: "ok",
    message: bin,
    detail: null,
    fix: null,
    fixLabel: null,
    url: null,
  };

  const { json, output } = await probeStatus(bin);
  const backendState = json?.BackendState ?? null;

  // No parseable status at all means the local API never answered.
  if (!json) {
    const canStart = existsSync(MAC_APP);

    return {
      bin,
      dnsName: null,
      ready: false,
      steps: [
        cliStep,
        {
          id: "daemon",
          title: "Tailscale running",
          state: "fail",
          message: canStart
            ? "The Tailscale service isn't running. Argus can start the app."
            : "The Tailscale service isn't running. Start tailscaled, then re-check.",
          detail: output || null,
          fix: canStart ? "start-daemon" : null,
          fixLabel: canStart ? "Start Tailscale" : null,
          url: null,
        },
        blocked("login", "Signed in"),
        blocked("funnel", "Funnel enabled"),
      ],
    };
  }

  const daemonStep: TailscaleStep = {
    id: "daemon",
    title: "Tailscale running",
    state: "ok",
    message: "The Tailscale service is running.",
    detail: null,
    fix: null,
    fixLabel: null,
    url: null,
  };

  // `Running` is the only state that means "signed in and usable".
  if (backendState !== "Running") {
    const stopped = backendState === "Stopped";

    return {
      bin,
      dnsName: null,
      ready: false,
      steps: [
        cliStep,
        daemonStep,
        {
          id: "login",
          title: "Signed in",
          state: "fail",
          message: stopped
            ? "Tailscale is disconnected. Argus can reconnect it."
            : "Not signed in to a tailnet. Argus can open the sign-in page.",
          detail: `BackendState: ${backendState ?? "unknown"}${
            output ? `\n${output}` : ""
          }`,
          fix: "sign-in",
          fixLabel: stopped ? "Reconnect" : "Sign in",
          url: null,
        },
        blocked("funnel", "Funnel enabled"),
      ],
    };
  }

  const dnsName = json.Self?.DNSName?.replace(/\.$/, "") ?? null;
  const loginStep: TailscaleStep = {
    id: "login",
    title: "Signed in",
    state: "ok",
    message: json.MagicDNSSuffix
      ? `Signed in to ${json.MagicDNSSuffix}.`
      : "Signed in.",
    detail: null,
    fix: null,
    fixLabel: null,
    url: null,
  };

  const funnelOk = hasFunnelCap(json.Self);
  const funnelStep: TailscaleStep = funnelOk
    ? {
        id: "funnel",
        title: "Funnel enabled",
        state: "ok",
        message: dnsName
          ? `Funnel is available at ${dnsName}.`
          : "Funnel is available.",
        detail: null,
        fix: null,
        fixLabel: null,
        url: null,
      }
    : {
        id: "funnel",
        title: "Funnel enabled",
        state: "fail",
        message:
          "Funnel isn't enabled for this node. Enable it in the Tailscale admin console, then re-check.",
        detail:
          "The tailnet hasn't granted this node the Funnel capability. Enabling it is a one-time change in the admin console.",
        fix: "open-url",
        fixLabel: "Enable Funnel",
        url: funnelEnableUrl(json.Self),
      };

  return {
    bin,
    dnsName,
    ready: funnelOk,
    steps: [cliStep, daemonStep, loginStep, funnelStep],
  };
}

export interface TailscaleFixResult {
  /** Fresh diagnosis after the fix, so the UI can just re-render. */
  diagnosis: TailscaleDiagnosis;
  /** A URL the renderer should open, when the fix produced one. */
  openUrl: string | null;
  /** Set when the fix itself failed, separate from the step states. */
  error: string | null;
}

/** `brew install tailscale` can take a while on a cold cache. */
const INSTALL_TIMEOUT_MS = 300_000;

async function installCli(): Promise<string | null> {
  try {
    await exec("brew", ["install", "tailscale"], {
      timeout: INSTALL_TIMEOUT_MS,
    });
    cachedBin = null;

    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };

    return `brew install tailscale failed: ${
      err.stderr?.trim() || err.message || "unknown error"
    }`;
  }
}

/** Opening the app starts its daemon and prompts for any needed permissions. */
async function startDaemon(): Promise<string | null> {
  if (!existsSync(MAC_APP)) {
    return "Tailscale.app isn't installed, so Argus can't start the service.";
  }
  try {
    await exec("open", ["-a", MAC_APP]);
  } catch (e) {
    return `Couldn't launch Tailscale.app: ${(e as Error).message}`;
  }

  // The local API needs a moment after launch before it answers.
  await waitForDaemon();

  return null;
}

async function waitForDaemon(): Promise<void> {
  const bin = await resolveTailscaleBin();
  if (!bin) {
    return;
  }
  for (let i = 0; i < 15; i += 1) {
    const { json } = await probeStatus(bin);
    if (json) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const LOGIN_URL_RE = /https:\/\/login\.tailscale\.com\/\S+/i;
const LOGIN_URL_TIMEOUT_MS = 45_000;

/**
 * Bring the node online and resolve as soon as an auth URL appears, so the
 * renderer can open a browser. The process is left running because it must stay
 * alive to finish the handshake once the user authorises in the browser.
 *
 * A node that's merely disconnected is still authenticated, so it needs `up`
 * (which reconnects and exits) rather than a fresh `login`.
 */
async function signIn(
  bin: string,
  reconnectOnly: boolean,
): Promise<{ error: string | null; url: string | null }> {
  const cmd = reconnectOnly ? "up" : "login";
  const proc = spawn(bin, [cmd], { stdio: ["ignore", "pipe", "pipe"] });

  return await new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (r: { error: string | null; url: string | null }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };

    const timer = setTimeout(() => {
      finish({
        error: `Timed out waiting for Tailscale. Run \`tailscale ${cmd}\` in a terminal.`,
        url: null,
      });
    }, LOGIN_URL_TIMEOUT_MS);

    const scan = (buf: Buffer) => {
      output += buf.toString();
      const url = LOGIN_URL_RE.exec(output)?.[0];
      if (url) {
        finish({ error: null, url });
      }
    };
    proc.stdout?.on("data", scan);
    proc.stderr?.on("data", scan);

    proc.on("error", (e) => finish({ error: e.message, url: null }));
    proc.on("exit", (code) => {
      // Exiting without a URL means it either already succeeded or failed.
      if (code === 0) {
        finish({ error: null, url: null });

        return;
      }
      finish({
        error: output.trim() || `tailscale ${cmd} exited (${code ?? "signal"})`,
        url: null,
      });
    });
  });
}

export async function applyTailscaleFix(
  fix: TailscaleFixKind,
  url?: string | null,
): Promise<TailscaleFixResult> {
  let error: string | null = null;
  let openUrl: string | null = null;

  if (fix === "open-url") {
    openUrl = url ?? null;
  } else if (fix === "install-cli") {
    error = await installCli();
  } else if (fix === "start-daemon") {
    error = await startDaemon();
  } else if (fix === "sign-in") {
    const bin = await resolveTailscaleBin();
    if (!bin) {
      error = "The Tailscale CLI isn't installed yet.";
    } else {
      const { json } = await probeStatus(bin);
      const result = await signIn(bin, json?.BackendState === "Stopped");
      error = result.error;
      openUrl = result.url;
      if (result.url) {
        // Give the daemon a chance to reach `Running` after authorisation.
        await waitForDaemon();
      }
    }
  }

  return { diagnosis: await diagnoseTailscale(), error, openUrl };
}
