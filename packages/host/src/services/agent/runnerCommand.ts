/**
 * Which sent messages were one of the runner's own slash commands, so the
 * transcript can show them as a command rather than as prose.
 */

import type { ConversationCommand } from "@argus/remote-protocol";
import { appState } from "../../state";

/** `/compact keep the plan` → its name and arguments, when the runner lists that command. */
export function parseRunnerCommand(
  message: string,
  runnerCommands: string[],
): ConversationCommand | null {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!match || !runnerCommands.includes(match[1]!)) {
    return null;
  }
  const args = (match[2] ?? "").trim();

  return { name: match[1]!, ...(args ? { args } : {}) };
}

/** The runner command `sent` was to this agent, for its transcript bubble. */
export function runnerCommandFor(
  agentId: string,
  sent: string,
): ConversationCommand | undefined {
  if (!sent.trimStart().startsWith("/")) {
    return undefined;
  }
  const commands =
    appState.agents.get(agentId)?.handle.initializeResponse()?.commands ?? [];

  return (
    parseRunnerCommand(
      sent,
      commands.map((c) => c.name),
    ) ?? undefined
  );
}
