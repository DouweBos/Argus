/**
 * Back-compat shim — Claude-specific orchestration moved into a runner under
 * `electron/services/llm/runners/claudeCode/` in Phase 1 of the LLM routing
 * abstraction. The runner-agnostic agent service lives in `agentService.ts`.
 *
 * Existing importers (`electron/ipc.ts`, `electron/services/mcp/server.ts`,
 * `electron/services/organizationTask/orchestrator.ts`) keep importing from
 * `./agent/claude` for now — they will migrate to `./agent/agentService` in
 * a follow-up cleanup. No behavior change.
 */

export {
  checkClaudeCli,
  claimPrewarmAgent,
  discardPrewarmAgent,
  emitMcpSystemMessage,
  ensureSimulatorForAgent,
  ensureWebBrowserForAgent,
  interruptAgent,
  listAgents,
  prewarmAgent,
  respondToPermission,
  restoreAgentAtTurn,
  sendAgentMessage,
  setAgentModel,
  setAgentPermissionMode,
  startAgent,
  stopAgent,
  waitForAgent,
  waitForAnyAgent,
  type ImageAttachment,
  type McpSystemMessagePayload,
} from "./agentService";
