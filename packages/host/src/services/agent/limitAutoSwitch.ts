/**
 * Auto-switch for agents stalled on a spent plan limit: when a project sets
 * `auto_switch_account_on_limit`, the agent moves to the signed-in Claude
 * account with the most usage left and continues there.
 */

import type { LimitHandoffAccount } from "@argus/remote-protocol";
import { addHostEventSink } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadArgusConfig } from "../session/argusConfig";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { handoffAgentToAccount } from "./accountSwitch";
import { isAgentBusy } from "./busy";
import { limitHandoffAccounts } from "./limitHandoff";

function autoSwitchEnabled(agentId: string): boolean {
  const agent = appState.agents.get(agentId);
  // Only Claude Code has more than one account, so a move never changes provider.
  if (!agent || agent.runner.id !== "claude-code") {
    return false;
  }
  const repoRoot = appState.sessions.get(agent.sessionId)?.repo_root;
  if (!repoRoot) {
    return false;
  }
  try {
    return loadArgusConfig(repoRoot).auto_switch_account_on_limit === true;
  } catch {
    return false;
  }
}

/**
 * The account that runs longest: lowest usage on its tightest window. Accounts
 * whose usage couldn't be read are skipped, since they may be spent too.
 */
export function pickAutoSwitchAccount(
  rows: LimitHandoffAccount[],
): LimitHandoffAccount | null {
  return rows.reduce<LimitHandoffAccount | null>((best, row) => {
    if (!row.usage) {
      return best;
    }

    return !best?.usage || row.usage.used_percent < best.usage.used_percent
      ? row
      : best;
  }, null);
}

function whenIdle(agentId: string): Promise<boolean> {
  const agent = appState.agents.get(agentId);
  if (!agent || agent.status === "stopped" || agent.status === "error") {
    return Promise.resolve(false);
  }
  if (!isAgentBusy(agent)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    // Deferred: waiters are resolved inside a loop that clears the list after.
    agent.turnWaiters.push((status) =>
      queueMicrotask(() => resolve(status === "idle")),
    );
  });
}

/** A turn just stalled on the limit: move it to another account when the project asks for that. */
export async function autoSwitchOnLimit(agentId: string): Promise<void> {
  if (!autoSwitchEnabled(agentId) || !(await whenIdle(agentId))) {
    return;
  }
  const target = pickAutoSwitchAccount(await limitHandoffAccounts(agentId));
  if (!target) {
    telemetryCapture("agent_limit_auto_switch", { outcome: "no_account" });

    return;
  }
  try {
    await handoffAgentToAccount(agentId, target.account_id, "auto_limit");
    telemetryCapture("agent_limit_auto_switch", { outcome: "switched" });
  } catch (e) {
    warn(`[agent:${agentId}] automatic account switch failed: ${String(e)}`);
    telemetryCapture("agent_limit_auto_switch", { outcome: "failed" });
  }
}

const STALL_PREFIX = "agent:limit-stall:";
let detach: (() => void) | null = null;

export function startLimitAutoSwitch(): void {
  detach ??= addHostEventSink((channel, args) => {
    if (channel.startsWith(STALL_PREFIX) && args[0] === true) {
      const agentId = channel.slice(STALL_PREFIX.length);
      autoSwitchOnLimit(agentId).catch((e: unknown) => {
        warn(
          `[agent:${agentId}] automatic account switch failed: ${String(e)}`,
        );
      });
    }
  });
}

export function stopLimitAutoSwitch(): void {
  detach?.();
  detach = null;
}
