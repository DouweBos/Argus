/**
 * Resolves Argus's per-user state directory. Defaults to `~/.argus` but can
 * be overridden by `ARGUS_HOME` in the environment, which is how a developer
 * runs a dev build alongside their production install without colliding on
 * `tools.json`, worktrees, sessions, etc.:
 *
 *   ARGUS_HOME="$HOME/.argus-dev" pnpm dev
 *
 * The headless server app defaults to `~/.argus-server` instead: it is fully
 * standalone and must never share worktrees, device keys or settings with a
 * desktop on the same machine.
 *
 * This module is deliberately leaf-level — no app-level imports, no
 * telemetry, no logger — so every other service can depend on it without
 * creating cycles.
 */

import os from "node:os";
import path from "node:path";
import { isServerMode } from "../serverMode";

export function argusHomeDir(): string {
  const override = process.env.ARGUS_HOME;
  if (override && override.trim().length > 0) {
    return override.trim();
  }

  return path.join(os.homedir(), isServerMode() ? ".argus-server" : ".argus");
}
