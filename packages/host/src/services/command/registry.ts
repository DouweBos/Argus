/**
 * The command registry — one table behind both local IPC and the wire.
 *
 * `defineCommand` is the only place a command is born: it records the
 * definition (name, tier, handler) and hands it to whatever binder the process
 * installed — `ipcMain.handle` in the desktop app, nothing at all in a headless
 * host. The remote gateway looks commands up here rather than reading
 * Electron's private `_invokeHandlers` map, so the two surfaces cannot drift.
 */

import { createLogger } from "@argus/host/logger";
import { GitError, serializeGitError } from "../session/gitError";

/**
 * How far a command may travel.
 * - "host": never crosses the wire. Acts on the machine the *window* is on, or
 *   mutates the trust store that authorises the wire itself.
 * - "monitor" / "control": the narrow tiers the phone and web clients hold.
 *   Raw commands are not on those clients' surface (they speak the dotted
 *   `REMOTE_METHODS` allowlist), so nothing carries them today.
 * - "admin": reachable by a paired Mac driving this host as if sitting at its
 *   keyboard. The default for anything that is not window- or trust-scoped.
 */
export type CommandTier = "admin" | "control" | "host" | "monitor";

export type CommandArgs = Record<string, unknown>;
export type CommandHandler = (args: CommandArgs) => Promise<unknown> | unknown;

export interface CommandOptions {
  tier: CommandTier;
  /** Reserved for a future schema; the registry does not validate today. */
  params?: unknown;
  handler: CommandHandler;
}

export interface CommandDefinition extends CommandOptions {
  name: string;
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
 * import order between `ipc.ts` and the bridge doesn't matter.
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
 * Run a command for a local transport: log what threw, and flatten `GitError`
 * into a plain `Error` carrying the structured payload as own enumerable props
 * (Electron preserves those across IPC). The gateway carries the same payload
 * in the wire error's `data` field, so it dispatches through `invokeCommand`.
 */
export async function dispatchCommand(
  name: string,
  args: CommandArgs = {},
): Promise<unknown> {
  const definition = commands.get(name);
  if (!definition) {
    throw new Error(`unknown command ${name}`);
  }
  try {
    return await definition.handler(args);
  } catch (err) {
    createLogger(`ipc:${name}`).error("handler threw:", err);
    if (err instanceof GitError) {
      const { message, ...rest } = serializeGitError(err);
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
 * handler's own error untouched so the caller can classify it.
 */
export async function invokeCommand(
  name: string,
  args: unknown,
): Promise<unknown> {
  const definition = commands.get(name);
  if (!definition) {
    throw new Error(`unknown command ${name}`);
  }

  return await definition.handler((args ?? {}) as CommandArgs);
}

/** Test-only: drop every registration so a suite can start from empty. */
export function resetCommandRegistry(): void {
  commands.clear();
  binder = null;
}
