/**
 * One-shot `codex exec` for titles and slugs: read-only, ephemeral, low
 * effort, answer read back from `--output-last-message`.
 */

import type { OneShotArgs } from "../types";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { warn } from "@argus/host/logger";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_SYSTEM_PROMPT =
  "You generate short titles and slugs. Reply with only what the user asks for, no tools, no explanation.";

export function codexExecArgs(args: OneShotArgs, outFile: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-c",
    'model_reasoning_effort="low"',
    "--output-last-message",
    outFile,
    ...(args.model ? ["--model", args.model] : []),
    "--",
    `${args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}\n\n${args.prompt}`,
  ];
}

export async function runCodexExec(
  bin: string,
  args: OneShotArgs,
): Promise<string | null> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "argus-codex-exec-"));
  const outFile = path.join(dir, "last-message.txt");
  try {
    const child = execFileAsync(bin, codexExecArgs(args, outFile), {
      timeout: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      cwd: args.cwd,
      env: args.env,
    });
    child.child.stdin?.end();
    await child;
    const answer = readFileSync(outFile, "utf8").trim();

    return answer || null;
  } catch (e) {
    warn(`${args.source} (codex exec) failed:`, e);

    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
