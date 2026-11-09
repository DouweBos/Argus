/**
 * One-shot prompt for titles and slugs: a throwaway plan-mode session whose
 * final text is the answer.
 */

import type { AcpHandle, AcpHandleInit } from "./handle";
import type { OneShotArgs } from "../types";
import os from "node:os";
import { warn } from "@argus/host/logger";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_SYSTEM_PROMPT =
  "You generate short titles and slugs. Reply with only what the user asks for, no tools, no explanation.";

type Start = (
  init: Omit<AcpHandleInit, "child" | "clientVersion" | "preset"> & {
    env?: NodeJS.ProcessEnv;
  },
) => Promise<AcpHandle>;

export async function runAcpOneShot(
  name: string,
  args: OneShotArgs,
  start: Start,
): Promise<string | null> {
  let handle: AcpHandle | null = null;
  try {
    handle = await start({
      agentId: `oneshot-${crypto.randomUUID()}`,
      cwd: args.cwd ?? os.tmpdir(),
      env: args.env,
      model: args.model ?? null,
      permissionMode: "plan",
      resumeRef: null,
      systemPrompt: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      mcpServers: {},
    });
    const h = handle;
    const answer = new Promise<string | null>((resolve, reject) => {
      h.on("stream-event", (l: string) => {
        const event = JSON.parse(l) as {
          type?: string;
          is_error?: boolean;
          result?: string;
        };
        if (event.type === "result") {
          if (event.is_error) {
            reject(event.result ?? "failed");
          } else {
            resolve(event.result?.trim() || null);
          }
        }
      });
      h.on("exit", () => reject(`${name} exited`));
    });
    await h.waitForInit();
    h.send(args.prompt);

    return await withTimeout(answer, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (e) {
    warn(`${args.source} (${name}) failed:`, e);

    return null;
  } finally {
    await handle?.kill();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(`timed out after ${ms}ms`), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
