/**
 * An ACP agent's open permission requests: decided by the mode policy, the
 * agent service's pre-hook, or the user, and answered with the option the
 * decision picks.
 */

import type { AcpPermissionOption, AcpToolCall } from "./protocol";
import type { RpcId, JsonRpcPeer } from "../rpc";
import type {
  CanonicalPermissionMode,
  PermissionDecisionInput,
  PermissionPreHook,
} from "../types";
import type { ToolUse } from "./translate";
import { acpVerdict, pickOption } from "./permissions";

interface Pending {
  rpcId: RpcId;
  options: AcpPermissionOption[];
}

export interface AcpApprovalsInit {
  rpc: JsonRpcPeer;
  cwd: string;
  disallowed: string[];
  preHook: PermissionPreHook | null;
  /** The agent saves "always allow" beyond the session. */
  noAlwaysAllow: boolean;
  emit: (event: "permission-cancel" | "permission-request", p: object) => void;
}

export class AcpApprovals {
  /** Keyed by the card id the user sees. */
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly opts: AcpApprovalsInit) {}

  ask(
    rpcId: RpcId,
    options: AcpPermissionOption[],
    call: AcpToolCall,
    use: Pick<ToolUse, "input" | "name">,
    toolUseId: string,
    mode: CanonicalPermissionMode,
  ): void {
    this.pending.set(toolUseId, { rpcId, options });
    const verdict = acpVerdict(mode, call, {
      cwd: this.opts.cwd,
      disallowed: this.opts.disallowed,
      toolName: use.name,
    });
    if (verdict !== "ask") {
      this.respond({ toolUseId, decision: verdict });

      return;
    }
    const decision = this.opts.preHook?.({
      toolName: use.name,
      toolUseId,
      input: use.input,
      rawRequest: { request_id: toolUseId },
      approveRaw: (jsonLine) =>
        this.answerFromControlResponse(toolUseId, jsonLine),
    });
    // ACP can't run a rewritten command, so a rewrite falls through to asking.
    if (decision?.kind === "handled") {
      return;
    }
    this.opts.emit("permission-request", {
      request_id: String(rpcId),
      tool_name: use.name,
      tool_input: use.input,
      tool_use_id: toolUseId,
    });
  }

  respond(decision: PermissionDecisionInput): void {
    const pending = this.pending.get(decision.toolUseId);
    if (!pending) {
      return;
    }
    this.pending.delete(decision.toolUseId);
    const always =
      !this.opts.noAlwaysAllow &&
      Boolean(decision.allowAll || decision.allowRule);
    const optionId = pickOption(pending.options, decision.decision, always);
    this.opts.rpc.respond(pending.rpcId, {
      outcome: optionId
        ? { outcome: "selected", optionId }
        : { outcome: "cancelled" },
    });
  }

  /** ACP: a finished or cancelled turn answers every open request `cancelled`. */
  cancelAll(): void {
    for (const [toolUseId, pending] of this.pending) {
      this.opts.rpc.respond(pending.rpcId, {
        outcome: { outcome: "cancelled" },
      });
      this.opts.emit("permission-cancel", {
        request_id: String(pending.rpcId),
        tool_use_id: toolUseId,
      });
    }
    this.pending.clear();
  }

  clear(): void {
    this.pending.clear();
  }

  /** The pre-hook answers in Claude's control_response; map it to a decision. */
  private answerFromControlResponse(toolUseId: string, jsonLine: string): void {
    let behavior: string | undefined;
    try {
      const parsed = JSON.parse(jsonLine) as {
        response?: { response?: { behavior?: string } };
      };
      behavior = parsed.response?.response?.behavior;
    } catch {
      behavior = undefined;
    }
    this.respond({
      toolUseId,
      decision: behavior === "allow" ? "allow" : "deny",
    });
  }
}
