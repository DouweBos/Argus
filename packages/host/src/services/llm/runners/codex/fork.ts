/**
 * Native Codex fork: a short-lived `codex app-server` reads the thread's turns
 * and forks it through the turn holding the Nth user message.
 */

import type { CodexThreadReadResponse, CodexTurnWithItems } from "./protocol";
import type { ForkTranscriptArgs } from "../types";
import { spawn } from "node:child_process";
import { info } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { killChild } from "../killChild";
import { JsonRpcPeer } from "../rpc";

const TIMEOUT_MS = 30_000;

/**
 * The turn to fork through so exactly `keep` user messages survive, or null
 * when no turn ends there (a message steered into the middle of a turn).
 */
export function pickForkTurn(
  turns: CodexTurnWithItems[],
  keep: number,
): string | null {
  let seen = 0;
  for (const turn of turns) {
    seen += (turn.items ?? []).filter((i) => i.type === "userMessage").length;
    if (seen === keep) {
      return turn.status === "inProgress" ? null : turn.id;
    }
    if (seen > keep) {
      return null;
    }
  }

  return null;
}

/** Fork `sourceRef` through turn `keepTurnNumber`; null when Codex can't. */
export async function forkCodexThread(
  bin: string,
  args: ForkTranscriptArgs,
): Promise<{ resumeRef: string | null }> {
  const child = spawn(bin, ["app-server"], {
    cwd: args.destCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...(args.env ?? process.env), RUST_LOG: "warn" },
  });
  child.on("error", () => undefined);
  if (!child.stdin || !child.stdout) {
    return { resumeRef: null };
  }
  const rpc: JsonRpcPeer = new JsonRpcPeer(child.stdin, child.stdout, {
    notification: () => undefined,
    request: (r) => rpc.respondError(r.id, "Argus is only forking"),
    malformed: () => undefined,
  });
  try {
    return await withTimeout(
      (async () => {
        await rpc.request("initialize", {
          clientInfo: {
            name: "argus",
            title: "Argus",
            version: hostPlatform().appVersion(),
          },
          capabilities: { experimentalApi: false, requestAttestation: false },
        });
        rpc.notify("initialized");
        const read = await rpc.request<CodexThreadReadResponse>("thread/read", {
          threadId: args.sourceRef,
          includeTurns: true,
        });
        const lastTurnId = pickForkTurn(
          read.thread.turns ?? [],
          args.keepTurnNumber,
        );
        if (!lastTurnId) {
          return { resumeRef: null };
        }
        const forked = await rpc.request<{ thread: { id: string } }>(
          "thread/fork",
          {
            threadId: args.sourceRef,
            lastTurnId,
            cwd: args.destCwd,
            excludeTurns: true,
          },
        );
        info(`[codex] forked ${args.sourceRef} → ${forked.thread.id}`);

        return { resumeRef: forked.thread.id };
      })(),
    );
  } finally {
    rpc.close("fork done");
    await killChild(child, "codex-fork");
  }
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject("codex fork timed out"), TIMEOUT_MS);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
