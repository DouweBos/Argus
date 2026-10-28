/**
 * `argus-host` — the Argus host core as a plain Node process. No Electron, no
 * window: sessions, agents, terminals, simulators and the gateway, driven by
 * any paired client.
 *
 * `--desktop` runs it as the Mac app's host instead: on `~/.argus`, with the
 * gateway following Settings, and the app attached over `--ui-socket`.
 * `--server` runs it under the native Argus Server menu-bar app: a supervised
 * server on `~/.argus-server`. See `hostMode.ts` for what each mode does.
 * Either way the UI socket is served and advertised in `host.lock`.
 */

import type { LocalUiServer } from "../services/remote/localUiSocket";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { shutdownHost, startHost, syncHostCleanup } from "../boot";
import { argusHomeDir } from "../lib/argusHome";
import { checkoutRoot } from "../lib/checkoutRoot";
import { acquireHostLock, releaseHostLock } from "../lib/hostLock";
import { nodeSecretStorage } from "../lib/nodeSecretStorage";
import { nodeHostPlatform, setHostPlatform } from "../platform";
import { startPowerAssertion } from "../serverMode";
import { startLink } from "../services/account/link";
import { stopAgentsForQuit } from "../services/agent/quit";
import { startDevTrust, stopDevTrust } from "../services/remote/devTrust";
import {
  defaultUiSocketPath,
  serveLocalUi,
} from "../services/remote/serveLocalUi";
import { attachConsoleAccount } from "./consoleAccount";
import { attachConsolePairing } from "./consolePairing";
import { parseHostArgs } from "./hostArgs";
import { gatewayLine } from "./hostBanner";
import { hostBehaviour } from "./hostEnv";
import { devTrustAllowed } from "./hostMode";

/** Exit code when another host holds this ARGUS_HOME; the Mac app keys on it. */
const EXIT_LOCKED = 75;

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function resolveWebClientDir(): string | null {
  const resources = process.env.ARGUS_RESOURCES;
  const candidate = resources
    ? path.join(resources, "argus-web")
    : path.join(checkoutRoot(), "clients", "argus-web", "dist");

  return fs.existsSync(path.join(candidate, "index.html")) ? candidate : null;
}

const args = parseHostArgs(process.argv.slice(2));

const lock = acquireHostLock(hostBehaviour.lockOwner, {
  ownerPid: args.ownerPid ?? undefined,
});
if (!lock.ok) {
  // One line of JSON the supervisor can parse, then out.
  print(JSON.stringify({ host_lock_held: lock.holder }));
  process.exit(EXIT_LOCKED);
}

const base = nodeHostPlatform({ secretStorage: nodeSecretStorage() });
setHostPlatform(base);
// Every host serves it, so a window can attach to whichever one holds the home.
const uiSocketPath = args.uiSocket ?? defaultUiSocketPath();
let uiServer: LocalUiServer | null = null;
const uiReady = serveLocalUi({
  socketPath: uiSocketPath,
  supervised: hostBehaviour.supervised,
}).then((server) => {
  uiServer = server;
});

if (hostBehaviour.powerAssertion) {
  // A sleeping Mac stops agents mid-run and drops every attached client.
  startPowerAssertion();
}

const { remoteReady } = startHost({
  forceRemote: hostBehaviour.forceRemote,
  webClientDir: resolveWebClientDir(),
});

let stopping = false;
function stop(): void {
  if (stopping) {
    process.exit(1);
  }
  stopping = true;
  print("Stopping…");
  // A supervised quit: agents get to stop cleanly (and save) before the
  // teardown kills whatever is left. The CLI just goes.
  const drained = hostBehaviour.drainAgentsOnQuit
    ? stopAgentsForQuit()
    : Promise.resolve();
  stopDevTrust();
  drained
    .then(() => Promise.allSettled([uiServer?.close(), shutdownHost()]))
    .finally(() => {
      releaseHostLock();
      process.exit(0);
    });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// A supervised host goes down with its app: a crashed app would otherwise
// leave it holding the lock with nobody to stop it.
if (args.ownerPid) {
  const ownerPid = args.ownerPid;
  setInterval(() => {
    try {
      process.kill(ownerPid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        stop();
      }
    }
  }, 2000).unref();
}
process.on("exit", () => {
  syncHostCleanup();
  releaseHostLock();
});

Promise.all([remoteReady, uiReady]).then(([remote]) => {
  print(`Argus host ${base.appVersion()}`);
  if (hostBehaviour.gatewayBanner) {
    print(gatewayLine(remote.error));
  }
  startDevTrust(devTrustAllowed(process.env, os.homedir())).catch(
    (err: unknown) => print(`Dev trust failed: ${String(err)}`),
  );
  print(`State: ${argusHomeDir()}`);
  // The supervisor waits for this line before connecting.
  print(`UI socket: ${uiSocketPath}`);
  if (process.stdin.isTTY && hostBehaviour.console) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("SIGINT", stop);
    attachConsolePairing(rl, print, attachConsoleAccount(print));
    print(
      'Type "pair" to pair a device, or "login" to link this computer to your account.',
    );
    if (args.login) {
      startLink("cli").catch((err: unknown) => print(String(err)));
    }
  } else if (args.login) {
    print("argus-host login needs an interactive terminal.");
  }
}, stop);
