/**
 * The code editor's file IO: versioned reads and hash-checked writes, watching
 * the open files, and ripgrep across the worktree.
 */

import { z } from "zod";
import { CodeFile, CodeSearchQuery, CodeWriteResult } from "../models/code";
import { type CommandSpec, Void } from "./spec";

const SessionFile = z.object({ id: z.string(), relativePath: z.string() });
const SessionFiles = z.object({ id: z.string(), paths: z.array(z.string()) });

export const CODE_COMMANDS = {
  /** Never throws for binary, oversized or non-UTF-8 files: see `readOnlyReason`. */
  code_read_file: { tier: "admin", params: SessionFile, result: CodeFile },
  /**
   * Atomic. Refuses with `conflict` when the file on disk isn't `baseHash`
   * (null: expected not to exist) unless `force`.
   */
  code_write_file: {
    tier: "admin",
    params: SessionFile.extend({
      content: z.string(),
      baseHash: z.string().nullable(),
      force: z.boolean().optional(),
    }),
    result: CodeWriteResult,
  },
  /**
   * Changes arrive as `code:file-changed:<sessionId>` (subscribe to scope
   * `code:<sessionId>`). Held per connection until unwatched or it closes.
   */
  code_watch_files: { tier: "admin", params: SessionFiles, result: Void },
  code_unwatch_files: { tier: "admin", params: SessionFiles, result: Void },
  /**
   * Results stream as `code:search:<searchId>`; subscribe to scope
   * `code-search:<searchId>` first, passing your own `searchId`.
   */
  code_search: {
    tier: "admin",
    params: CodeSearchQuery.extend({
      id: z.string(),
      searchId: z
        .string()
        .regex(/^[\w-]{1,64}$/)
        .optional(),
    }),
    result: z.object({ searchId: z.string() }),
  },
  code_search_cancel: {
    tier: "admin",
    params: z.object({ searchId: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
