/**
 * `code_format`: runs the project's own formatter over a buffer the editor
 * sends, on stdin, in the worktree. Never writes the file — the client applies
 * the result and saves.
 */

import type { CodeFormatResult } from "@argus/remote-protocol";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolveContainedPath } from "../file/operations";
import { resolveFormatter, type FormatterRun } from "./formatters";
import { canonicalSessionRoot } from "./paths";

export const FORMAT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runFormatter(
  run: FormatterRun,
  input: string,
  timeoutMs = FORMAT_TIMEOUT_MS,
): Promise<RunOutput> {
  return new Promise((resolve) => {
    const child = spawn(run.command, run.args, {
      cwd: run.cwd,
      env: { ...process.env, ...run.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // A wrapper (npx, a shim) can leave a child holding the pipes open, and then
      // "close" never comes: answer now rather than hang the editor's save.
      resolve({
        code: null,
        stdout: "",
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
      } else {
        out.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
      });
    });
    // A formatter that exits before reading all of stdin closes the pipe on us.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const NAMES: Record<CodeFormatResult["formatter"], string> = {
  prettier: "Prettier",
  swiftformat: "SwiftFormat",
  "swift-format": "swift-format",
  gofmt: "gofmt",
  ruff: "Ruff",
  black: "Black",
  none: "The formatter",
};

/** The formatter's complaint, short enough for a status bar tooltip. */
export function describeFailure(
  formatter: CodeFormatResult["formatter"],
  output: RunOutput,
): string {
  if (output.timedOut) {
    return `${NAMES[formatter]} took longer than ${FORMAT_TIMEOUT_MS / 1000} s`;
  }
  const lines = output.stderr
    .split("\n")
    .map((line) => line.replace(/^\[error\]\s?/, "").trimEnd())
    .filter((line) => line.trim() !== "");
  const message = lines.slice(0, 4).join("\n").slice(0, 600);

  return message || `${NAMES[formatter]} exited with code ${output.code}`;
}

/**
 * Formats `content` as the file at `relativePath` with the project's formatter.
 * Without `content`, only says which formatter applies.
 */
export async function formatCode(
  id: string,
  relativePath: string,
  content?: string,
): Promise<CodeFormatResult> {
  const root = canonicalSessionRoot(id);
  const file = await resolveContainedPath(id, relativePath, {
    mustExist: false,
  });
  if (path.relative(root, file).startsWith("..")) {
    return { formatter: "none", formatted: null };
  }
  const resolved = await resolveFormatter(root, file);
  if (!resolved) {
    return { formatter: "none", formatted: null };
  }
  if ("missing" in resolved) {
    return {
      formatter: resolved.formatter,
      formatted: null,
      error: resolved.missing,
    };
  }
  if (content === undefined) {
    return { formatter: resolved.formatter, formatted: null };
  }
  const output = await runFormatter(resolved, content);
  const silent = output.stdout === "" && content.trim() !== "";
  if (output.code !== 0 || output.timedOut || silent) {
    return {
      formatter: resolved.formatter,
      formatted: null,
      error: describeFailure(resolved.formatter, output),
    };
  }

  return {
    formatter: resolved.formatter,
    formatted: output.stdout === content ? null : output.stdout,
  };
}
