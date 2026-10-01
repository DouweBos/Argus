/**
 * `argus-host` — the Argus host core as a plain Node process. No Electron, no
 * window: sessions, agents, terminals, simulators and the gateway, driven by
 * any paired client.
 *
 * `--desktop` runs it as the Mac app's host instead: on `~/.argus`, with the
 * gateway following Settings, and the app attached over `--ui-socket`.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { shutdownHost, startHost, syncHostCleanup } from "../boot";
import { argusHomeDir } from "../lib/argusHome";
import { acquireHostLock, releaseHostLock } from "../lib/hostLock";
import { nodeSecretStorage } from "../lib/nodeSecretStorage";
import { nodeHostPlatform, setHostPlatform } from "../platform";
import { startPowerAssertion } from "../serverMode";
import {
  startLocalUiSocket,
  type LocalUiServer,
} from "../services/remote/localUiSocket";
import { LOCAL_GATEWAY_PORT } from "../services/remote/remoteService";
import { uiHostPlatform } from "../services/remote/uiHostPlatform";
import { attachConsolePairing } from "./consolePairing";
import { parseHostArgs } from "./hostArgs";
import { desktopMode } from "./hostEnv";

/** Exit code when another host holds this ARGUS_HOME; the Mac app keys on it. */
const EXIT_LOCKED = 75;

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function resolveWebClientDir(): string | null {
  const resources = process.env.ARGUS_RESOURCES;
  const candidate = resources
    ? path.join(resources, "argus-web")
    : path.join(process.cwd(), "clients", "argus-web", "dist");

  return fs.existsSync(path.join(candidate, "index.html")) ? candidate : null;
}

const args = parseHostArgs(process.argv.slice(2));

const lock = acquireHostLock(desktopMode ? "mac" : "cli", {
  ownerPid: args.ownerPid ?? undefined,
});
if (!lock.ok) {
  // One line of JSON the supervisor can parse, then out.
  print(JSON.stringify({ host_lock_held: lock.holder }));
  process.exit(EXIT_LOCKED);
}

const base = nodeHostPlatform({ secretStorage: nodeSecretStorage() });
setHostPlatform(base);
const uiSocketPath =
  args.uiSocket ??
  (desktopMode ? path.join(argusHomeDir(), "host.sock") : null);
let uiServer: LocalUiServer | null = null;
const uiReady = uiSocketPath
  ? startLocalUiSocket(uiSocketPath).then((server) => {
      uiServer = server;
      setHostPlatform(uiHostPlatform(server.channel, base));
    })
  : Promise.resolve();

if (!desktopMode) {
  // A sleeping Mac stops agents mid-run and drops every attached client.
  startPowerAssertion();
}

const { remoteReady } = startHost({
  forceRemote: !desktopMode,
  webClientDir: resolveWebClientDir(),
});

let stopping = false;
function stop(): void {
  if (stopping) {
    process.exit(1);
  }
  stopping = true;
  print("Stopping…");
  Promise.allSettled([uiServer?.close(), shutdownHost()]).finally(() => {
    releaseHostLock();
    process.exit(0);
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", () => {
  syncHostCleanup();
  releaseHostLock();
});

Promise.all([remoteReady, uiReady]).then(() => {
  print(`Argus host ${base.appVersion()}`);
  if (!desktopMode) {
    print(`Gateway: ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`);
  }
  print(`State: ${argusHomeDir()}`);
  if (uiSocketPath) {
    // The supervisor waits for this line before connecting.
    print(`UI socket: ${uiSocketPath}`);
  }
  if (process.stdin.isTTY && !desktopMode) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("SIGINT", stop);
    attachConsolePairing(rl, print);
    print('Type "pair" to pair a device.');
  }
}, stop);
