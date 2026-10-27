/**
 * The command registry — one table behind both local IPC and the wire.
 *
 * `defineCommand` is the only place a command is born: it records the
 * definition (name, tier, handler) and hands it to whatever binder the process
 * installed — `ipcMain.handle` in the desktop app, nothing at all in a headless
 * host. The remote gateway looks commands up here rather than reading
 * Electron's private `_invokeHandlers` map, so the two surfaces cannot drift.
 */

import {
  type CommandName,
  type CommandTier,
  type ParamsOf,
  type ResultOf,
  type ToolId,
  COMMANDS,
  UNKNOWN_COMMAND,
} from "@argus/remote-protocol";
import type { z } from "zod";
import { createLogger } from "@argus/host/logger";
import { hostPlatform } from "../../platform";
import { ShareError } from "../remote/shareError";
import { GitError, serializeGitError } from "../session/gitError";
import { toolEnabled } from "../tools/state";

export type { CommandTier } from "@argus/remote-protocol";

export type CommandArgs = Record<string, unknown>;

/** A command this host doesn't register; `code` and `command` survive IPC. */
export class UnknownCommandError extends Error {
  readonly code = UNKNOWN_COMMAND;

  constructor(readonly command: string) {
    super(`unknown command ${command}`);
    this.name = "UnknownCommandError";
  }
}
export type CommandHandler = (args: CommandArgs) => Promise<unknown> | unknown;

export interface CommandOptions {
  tier: CommandTier;
  /** Validated at dispatch; the handler receives the parsed value. */
  params?: z.ZodType;
  /** Checked in dev builds and tests, never enforced in production. */
  result?: z.ZodType;
  /** The handler only runs while this tool is enabled. */
  tool?: ToolId;
  handler: CommandHandler;
}

export interface CommandDefinition extends CommandOptions {
  name: string;
}

/** Args that fail a command's param schema. Carries `bad_request` on the wire. */
export class CommandParamsError extends Error {
  readonly code = "bad_request";
  readonly issues: { path: string; message: string }[];

  constructor(name: string, error: z.ZodError) {
    const issues = error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const first = issues[0];
    super(
      `invalid params for ${name}${first ? `: ${first.path || "(root)"} ${first.message}` : ""}`,
    );
    this.name = "CommandParamsError";
    this.issues = issues;
  }

  toPayload(): { code: "bad_request"; issues: CommandParamsError["issues"] } {
    return { code: this.code, issues: this.issues };
  }
}

const commands = new Map<string, CommandDefinition>();

/**
 * Publishes a command on a local transport. The desktop installs one that
 * calls `ipcMain.handle`; a CLI or headless host installs none.
 */
export type CommandBinder = (definition: CommandDefinition) => void;

let binder: CommandBinder | null = null;

/**
 * Install the local transport binder. Replays every command defined so far, so
 * the order commands and the bridge are set up in doesn't matter.
 */
export function setCommandBinder(next: CommandBinder | null): void {
  binder = next;
  if (!next) {
    return;
  }
  for (const definition of commands.values()) {
    next(definition);
  }
}

/**
 * Register a command: one entry in the registry, one binder call.
 */
export function defineCommand(name: string, options: CommandOptions): void {
  if (commands.has(name)) {
    throw new Error(`duplicate command registration: ${name}`);
  }
  const definition: CommandDefinition = { name, ...options };
  commands.set(name, definition);
  binder?.(definition);
}

/**
 * Register a command from the catalog. Tier, tool gate and schemas come from
 * its entry, so the handler is typed by the same contract every client uses.
 */
export function defineTypedCommand<N extends CommandName>(
  name: N,
  handler: (params: ParamsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>,
): void {
  const spec = COMMANDS[name] as unknown as Omit<CommandOptions, "handler">;
  defineCommand(name, {
    tier: spec.tier,
    params: spec.params,
    result: spec.result,
    tool: spec.tool,
    handler: handler as CommandHandler,
  });
}

type ResultCheck = "log" | "off" | "throw";

function resultCheck(): ResultCheck {
  if (process.env.VITEST) {
    return "throw";
  }

  return hostPlatform().isPackaged() ? "off" : "log";
}

/** Gate, validate, run, and (outside production) check the result. */
async function runCommand(
  definition: CommandDefinition,
  args: unknown,
): Promise<unknown> {
  const { name, params, result, tool } = definition;
  if (tool && !toolEnabled(tool)) {
    throw `tool disabled: ${tool}`;
  }
  let input: unknown = args ?? {};
  if (params) {
    const parsed = params.safeParse(input);
    if (!parsed.success) {
      throw new CommandParamsError(name, parsed.error);
    }
    input = parsed.data;
  }
  const value = await definition.handler(input as CommandArgs);
  const mode = result ? resultCheck() : "off";
  if (result && mode !== "off") {
    const checked = result.safeParse(value);
    if (!checked.success) {
      const message = `result of ${name} does not match its schema: ${checked.error.message}`;
      if (mode === "throw") {
        throw new Error(message);
      }
      createLogger(`ipc:${name}`).error(message);
    }
  }

  return value;
}

function errorPayload(err: CommandParamsError | GitError | ShareError): {
  message: string;
} {
  if (err instanceof GitError) {
    return serializeGitError(err);
  }
  if (err instanceof ShareError) {
    return err.toPayload();
  }

  return { message: err.message, ...err.toPayload() };
}

/**
 * Run a command for a local transport: log what threw, and flatten structured
 * errors into a plain `Error` carrying the payload as own enumerable props
 * (Electron preserves those across IPC). The gateway carries the same payload
 * in the wire error's `data` field, so it dispatches through `invokeCommand`.
 */
export async function dispatchCommand(
  name: string,
  args: CommandArgs = {},
): Promise<unknown> {
  const definition = commands.get(name);
  if (!definition) {
    throw new UnknownCommandError(name);
  }
  try {
    return await runCommand(definition, args);
  } catch (err) {
    createLogger(`ipc:${name}`).error("handler threw:", err);
    if (
      err instanceof GitError ||
      err instanceof ShareError ||
      err instanceof CommandParamsError
    ) {
      const { message, ...rest } = errorPayload(err);
      const wrapped = new Error(message);
      Object.assign(wrapped, rest);
      throw wrapped;
    }
    throw err;
  }
}

/** The definition registered for a command, or null when there is none. */
export function getCommand(name: string): CommandDefinition | null {
  return commands.get(name) ?? null;
}

/** Whether a command name is registered. */
export function hasCommand(name: string): boolean {
  return commands.has(name);
}

/** The tier a command was registered with, or null when it is unknown. */
export function getCommandTier(name: string): CommandTier | null {
  return commands.get(name)?.tier ?? null;
}

/** Every registered command, in registration order. */
export function listCommands(): CommandDefinition[] {
  return [...commands.values()];
}

/** Every command registered at a given tier. */
export function commandNamesForTier(tier: CommandTier): string[] {
  return listCommands()
    .filter((c) => c.tier === tier)
    .map((c) => c.name);
}

/**
 * Invoke a command's handler directly — the path the gateway takes. Throws the
 * handler's own error (or a `CommandParamsError`) untouched so the caller can
 * classify it.
 */
export async function invokeCommand(
  name: string,
  args: unknown,
): Promise<unknown> {
  const definition = commands.get(name);
  if (!definition) {
    throw new UnknownCommandError(name);
  }

  return await runCommand(definition, args);
}

/** Test-only: drop every registration so a suite can start from empty. */
export function resetCommandRegistry(): void {
  commands.clear();
  binder = null;
}
