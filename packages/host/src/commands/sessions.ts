import { pinSessionClaudeAccount } from "../services/agent/agentService";
import { defineTypedCommand } from "../services/command/registry";
import {
  importCliProjects,
  scanCliProjectsForClients,
} from "../services/externalChats/projectScan";
import { collectAllProjects } from "../services/mcp/projectDiscovery";
import {
  createScratchPad,
  listScratchPads,
} from "../services/scratchPad/manager";
import { getSession, hydrateHostState } from "../services/session/hostState";
import {
  addRepoRoot,
  clearSessionSetupError,
  createHeadSession,
  createSession,
  deleteSession,
  forkChatInSession,
  forkSession,
  listSessions,
  removeRepoRoot,
  renameSession,
  renameSessionBranch,
  retrySessionSetup,
} from "../services/session/manager";

export function registerSessionCommands(): void {
  defineTypedCommand("add_repo_root", (p) => addRepoRoot(p.path));
  defineTypedCommand("remove_repo_root", (p) => removeRepoRoot(p.path));
  defineTypedCommand("list_projects", () => collectAllProjects());
  defineTypedCommand("scan_cli_projects", () => scanCliProjectsForClients());
  defineTypedCommand("import_cli_projects", (p) => importCliProjects(p.paths));
  defineTypedCommand("state_hydrate", () => hydrateHostState());
  defineTypedCommand("list_sessions", (p) => listSessions(p.repoRoot));
  defineTypedCommand("list_scratch_pads", () => listScratchPads());
  defineTypedCommand("create_scratch_pad", (p) =>
    createScratchPad({ name: p.name }),
  );
  defineTypedCommand("create_session", (p) =>
    createSession(
      p.repoRoot,
      p.branch,
      p.description,
      p.useExistingBranch,
      p.baseBranch,
      p.llm,
    ),
  );
  defineTypedCommand("create_project_root_session", (p) =>
    createHeadSession(p.repoRoot),
  );
  defineTypedCommand("delete_session", (p) =>
    deleteSession(p.id, p.shouldDeleteBranch),
  );
  defineTypedCommand("rename_session", (p) =>
    renameSession(p.id, p.displayName),
  );
  defineTypedCommand("rename_session_branch", (p) =>
    renameSessionBranch(p.id, p.branch),
  );
  defineTypedCommand("clear_session_setup_error", (p) =>
    clearSessionSetupError(p.id),
  );
  defineTypedCommand("retry_session_setup", (p) => retrySessionSetup(p.id));
  defineTypedCommand("fork_session", (p) =>
    forkSession(
      p.sourceSessionId,
      p.branch,
      p.description,
      p.forkTimestampMs,
      p.forkTurnNumber,
      p.sourceClaudeSessionId,
      p.replayOps,
    ),
  );
  defineTypedCommand("fork_chat_in_session", (p) =>
    forkChatInSession(
      p.sourceSessionId,
      p.sourceClaudeSessionId,
      p.forkTimestampMs,
      p.forkTurnNumber,
    ),
  );
  defineTypedCommand("set_session_claude_account", (p) =>
    pinSessionClaudeAccount(
      p.sessionId,
      p.accountId ?? null,
      p.agentId ?? null,
    ),
  );
  defineTypedCommand("get_session", (p) => getSession(p.id));
}
