/**
 * Slash commands Argus itself ships to every agent, whatever its runner. The
 * composer lists them next to the runner's own; a message that starts with
 * one is expanded here before it reaches the agent, while the transcript keeps
 * what the user typed.
 */

import type { ArgusConfig } from "../../session/models";
import type { AgentSlashCommand } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { excludeFromGit } from "../../design/files";
import { loadArgusConfig } from "../../session/argusConfig";
import { capture } from "../../telemetry/telemetry";
import { implementTicketPrompt, VERIFY_DIR } from "./implementTicket";

export const IMPLEMENT_TICKET = "implement-ticket";

export const ARGUS_COMMANDS: AgentSlashCommand[] = [
  {
    name: IMPLEMENT_TICKET,
    description:
      "Implement a Linear ticket and prove every acceptance criterion on device",
    argumentHint: "<ENG-123> [notes]",
  },
];

/** The runner's commands plus Argus's; a runner's own command of the same name wins. */
type WithCommands<T> = Omit<T, "commands"> & { commands: AgentSlashCommand[] };

export function withArgusCommands<T extends { commands?: unknown }>(
  caps: T,
): WithCommands<T>;
export function withArgusCommands<T extends { commands?: unknown }>(
  caps: T | null,
): WithCommands<T> | null;
export function withArgusCommands<T extends { commands?: unknown }>(
  caps: T | null,
): WithCommands<T> | null {
  if (!caps) {
    return null;
  }
  const own = Array.isArray(caps.commands)
    ? (caps.commands as AgentSlashCommand[])
    : [];
  const names = new Set(own.map((c) => c.name));

  return {
    ...caps,
    commands: [...own, ...ARGUS_COMMANDS.filter((c) => !names.has(c.name))],
  };
}

/** What a client's Verify start sends: the command, then the user's notes. */
export function implementTicketMessage(ticket: string, notes: string): string {
  const extra = notes.trim();

  return `/${IMPLEMENT_TICKET} ${ticket}${extra ? `\n\n${extra}` : ""}`;
}

/** `/implement-ticket ENG-123 notes` → its name and arguments; null for anything else. */
export function parseArgusCommand(
  message: string,
): { name: string; ticket: string; extra: string } | null {
  const match = /^\/([a-z][a-z-]*)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(
    message.trim(),
  );
  if (!match || !ARGUS_COMMANDS.some((c) => c.name === match[1])) {
    return null;
  }

  return {
    name: match[1]!,
    ticket: match[2] ?? "",
    extra: (match[3] ?? "").trim(),
  };
}

function bucket(n: number): "0" | "1" | "2" | "3+" {
  return n >= 3 ? "3+" : (String(n) as "0" | "1" | "2");
}

/**
 * The prompt to send instead of `message`, or null when it isn't an Argus
 * command (or the runner has its own command of that name).
 */
export function expandArgusCommand(
  message: string,
  ctx: { worktree: string | null; runnerCommands: string[] },
): string | null {
  const parsed = parseArgusCommand(message);
  if (!parsed || ctx.runnerCommands.includes(parsed.name)) {
    return null;
  }
  let config: ArgusConfig | null = null;
  if (ctx.worktree) {
    try {
      config = loadArgusConfig(ctx.worktree);
    } catch (e) {
      warn(`[argus-commands] .argus.json unreadable: ${String(e)}`);
    }
    excludeFromGit(ctx.worktree, VERIFY_DIR).catch((e: unknown) =>
      warn(`[argus-commands] couldn't keep ${VERIFY_DIR} out of git: ${e}`),
    );
  }
  const verify = config?.verify ?? null;
  capture("implement_ticket_started", {
    has_ticket: parsed.ticket.length > 0,
    has_notes: parsed.extra.length > 0,
    has_verify: verify != null,
    devices: bucket(verify?.devices.length ?? 0),
    checks: bucket(verify?.checks.length ?? 0),
    sign_in: Boolean(verify?.sign_in),
    baseline: verify?.baseline !== false,
    slow_backend: Boolean(verify?.slow_backend),
  });

  return implementTicketPrompt({
    ticket: parsed.ticket,
    extra: parsed.extra,
    verify,
    runCommands: (config?.run ?? []).map((r) => r.title),
  });
}
