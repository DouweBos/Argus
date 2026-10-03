import { z } from "zod";
import {
  RunTerminalResult,
  TerminalScrollback,
  TerminalSummary,
} from "../models/terminals";
import { type CommandSpec, Void } from "./spec";

const Terminal = z.object({ sessionId: z.string() });
const Size = Terminal.extend({ cols: z.number(), rows: z.number() });

export const TERMINAL_COMMANDS = {
  /**
   * Deliberately takes no free-form `command`. Letting the renderer (or any
   * caller transitively reaching this command) inject an arbitrary
   * `sh -c <command>` would turn any renderer compromise (XSS via
   * agent/file/MCP-controlled markdown) into full RCE. Starting the session's
   * configured run command goes through `create_run_terminal`, which resolves
   * it host-side from `.argus.json`.
   */
  create_terminal: {
    tier: "admin",
    params: z.object({
      sessionId: z.string(),
      subDir: z.string().optional(),
      title: z.string().optional(),
    }),
    result: z.string(),
  },
  create_run_terminal: {
    tier: "admin",
    params: z.object({ sessionId: z.string(), title: z.string().optional() }),
    result: RunTerminalResult,
  },
  list_terminals: {
    tier: "admin",
    params: Terminal,
    result: z.array(TerminalSummary),
  },
  update_terminal_title: {
    tier: "admin",
    params: z.object({ terminalId: z.string(), title: z.string() }),
    result: Void,
  },
  start_terminal: { tier: "admin", params: Size, result: Void },
  destroy_terminal: { tier: "admin", params: Terminal, result: Void },
  /** SIGINT → SIGTERM → SIGKILL; `terminal:exit:{id}` fires once it exits. */
  stop_terminal: { tier: "admin", params: Terminal, result: Void },
  terminal_write: {
    tier: "admin",
    params: Terminal.extend({ data: z.string() }),
    result: Void,
  },
  terminal_resize: { tier: "admin", params: Size, result: Void },
  /**
   * Output captured so far, for a client reattaching to a running terminal.
   * Subscribe to `terminal:data` first; events sequenced after this response
   * carry exactly what the replay doesn't.
   */
  terminal_scrollback: {
    tier: "admin",
    params: Terminal,
    result: TerminalScrollback,
  },
} as const satisfies Record<string, CommandSpec>;
