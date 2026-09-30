/**
 * `argus-host` — the Argus host core as a plain Node process. No Electron, no
 * window: sessions, agents, terminals, simulators and the gateway, driven by
 * any paired client.
 */

import "./hostEnv";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { shutdownHost, startHost, syncHostCleanup } from "../boot";
import { argusHomeDir } from "../lib/argusHome";
import { nodeSecretStorage } from "../lib/nodeSecretStorage";
import { nodeHostPlatform, setHostPlatform } from "../platform";
import { startPowerAssertion } from "../serverMode";
import { LOCAL_GATEWAY_PORT } from "../services/remote/remoteService";
import { attachConsolePairing } from "./consolePairing";

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

setHostPlatform(nodeHostPlatform({ secretStorage: nodeSecretStorage() }));
// A sleeping Mac stops agents mid-run and drops every attached client.
startPowerAssertion();

const { remoteReady } = startHost({
  forceRemote: true,
  webClientDir: resolveWebClientDir(),
});

let stopping = false;
function stop(): void {
  if (stopping) {
    process.exit(1);
  }
  stopping = true;
  print("Stopping…");
  shutdownHost().finally(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", syncHostCleanup);

remoteReady.then(() => {
  print(`Argus host ${nodeHostPlatform().appVersion()}`);
  print(`Gateway: ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`);
  print(`State: ${argusHomeDir()}`);
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("SIGINT", stop);
    attachConsolePairing(rl, print);
    print('Type "pair" to pair a device.');
  }
}, stop);
