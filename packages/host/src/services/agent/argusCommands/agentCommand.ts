import type { ConversationCommand } from "@argus/remote-protocol";
import { appState } from "../../../state";
import { describeCommand } from "./index";

/** Where an agent's commands expand: its worktree, and the runner's own command names. */
export function commandContext(agentId: string): {
  worktree: string | null;
  runnerCommands: string[];
} {
  const agent = appState.agents.get(agentId);
  const session = agent ? appState.sessions.get(agent.sessionId) : undefined;

  return {
    worktree: session?.path ?? null,
    runnerCommands: (agent?.handle.initializeResponse()?.commands ?? []).map(
      (c) => c.name,
    ),
  };
}

/** The command `sent` was to this agent, for its transcript bubble. */
export function describeAgentCommand(
  agentId: string,
  sent: string,
): ConversationCommand | undefined {
  if (!sent.trimStart().startsWith("/")) {
    return undefined;
  }

  return describeCommand(sent, commandContext(agentId)) ?? undefined;
}
