/**
 * Back-compat shim — Claude-specific orchestration moved into a runner under
 * `electron/services/llm/runners/claudeCode/` in Phase 1 of the LLM routing
 * abstraction. The runner-agnostic agent service lives in `agentService.ts`.
 *
 * Existing importers (`commands/agents.ts`, `services/mcp/server.ts`)
 * keep importing from `./agent/claude` for now — they will migrate to
 * `./agent/agentService` in a follow-up cleanup. No behavior change.
 */

export {
  checkClaudeCli,
  emitMcpSystemMessage,
  ensureSimulatorForAgent,
  ensureWebBrowserForAgent,
  interruptAgent,
  listAgents,
  respondToPermission,
  restoreAgentAtTurn,
  sendAgentMessage,
  setAgentEffort,
  setAgentModel,
  setAgentPermissionMode,
  startAgent,
  stopAgent,
  waitForAgent,
  waitForAnyAgent,
  type ImageAttachment,
  type McpSystemMessagePayload,
} from "./agentService";
