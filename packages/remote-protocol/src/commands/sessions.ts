import { z } from "zod";
import { DesignRef, LinkedIssue } from "../models/integrations";
import {
  CliProjectImportSource,
  CliProjectScan,
  ForkChatResult,
  ForkReplayOp,
  ForkSessionResult,
  HostSnapshot,
  ProjectEntry,
  Session,
} from "../models/sessions";
import { type CommandSpec, NoParams, Void } from "./spec";

const RepoPath = z.object({ path: z.string() });
const RepoRoot = z.object({ repoRoot: z.string() });
const SessionId = z.object({ id: z.string() });

export const SESSION_COMMANDS = {
  add_repo_root: { tier: "admin", params: RepoPath, result: Void },
  remove_repo_root: { tier: "admin", params: RepoPath, result: Void },
  /** Directories the Claude Code CLI has chats for, newest first. */
  scan_cli_projects: {
    tier: "admin",
    params: z.object({ source: CliProjectImportSource.optional() }),
    result: CliProjectScan,
  },
  /** Add the picked directories as projects; their CLI chats import on add. */
  import_cli_projects: {
    tier: "admin",
    params: z.object({
      paths: z.array(z.string()),
      source: CliProjectImportSource.optional(),
    }),
    result: z.object({ added: z.number() }),
  },
  list_projects: {
    tier: "admin",
    params: NoParams,
    result: z.array(ProjectEntry),
  },
  /**
   * One snapshot of everything this host is running. Local IPC never drops so
   * the desktop never needs it; a client attaching over the gateway does — on
   * connect and after every reconnect.
   */
  state_hydrate: { tier: "admin", params: NoParams, result: HostSnapshot },
  list_sessions: { tier: "admin", params: RepoRoot, result: z.array(Session) },
  list_scratch_pads: {
    tier: "admin",
    params: NoParams,
    result: z.array(Session),
  },
  create_scratch_pad: {
    tier: "admin",
    params: z.object({ name: z.string().nullish() }),
    result: Session,
  },
  create_session: {
    tier: "admin",
    params: RepoRoot.extend({
      branch: z.string(),
      description: z.string(),
      useExistingBranch: z.boolean().optional(),
      baseBranch: z.string().optional(),
      llm: z
        .object({
          runner: z.string().nullish(),
          model: z.string().nullish(),
        })
        .optional(),
      /** Names the session after the issue and moves the issue to started. */
      linkedIssue: LinkedIssue.optional(),
      designRefs: z.array(DesignRef).optional(),
    }),
    result: Session,
  },
  create_project_root_session: {
    tier: "admin",
    params: RepoRoot,
    result: Session,
  },
  delete_session: {
    tier: "admin",
    params: SessionId.extend({ shouldDeleteBranch: z.boolean().optional() }),
    result: Void,
  },
  rename_session: {
    tier: "admin",
    params: SessionId.extend({ displayName: z.string() }),
    result: Void,
  },
  rename_session_branch: {
    tier: "admin",
    params: SessionId.extend({ branch: z.string() }),
    result: Void,
  },
  clear_session_setup_error: {
    tier: "admin",
    params: SessionId,
    result: Void,
  },
  retry_session_setup: { tier: "admin", params: SessionId, result: Void },
  fork_session: {
    tier: "admin",
    params: z.object({
      sourceSessionId: z.string(),
      branch: z.string(),
      description: z.string(),
      forkTimestampMs: z.number(),
      forkTurnNumber: z.number(),
      sourceClaudeSessionId: z.string().nullish(),
      replayOps: z.array(ForkReplayOp).nullish(),
    }),
    result: ForkSessionResult,
  },
  fork_chat_in_session: {
    tier: "admin",
    params: z.object({
      sourceSessionId: z.string(),
      sourceClaudeSessionId: z.string(),
      forkTimestampMs: z.number(),
      forkTurnNumber: z.number(),
    }),
    result: ForkChatResult,
  },
  /**
   * Pin a session to a Claude account (`null` follows the active one).
   * `agentId` restarts that agent on it while it has no conversation yet.
   */
  set_session_claude_account: {
    tier: "admin",
    params: z.object({
      sessionId: z.string(),
      accountId: z.string().nullish(),
      agentId: z.string().nullish(),
    }),
    result: z.null(),
  },
  /** Figma frames the session's work should match; empty clears them. */
  set_session_design_refs: {
    tier: "admin",
    params: z.object({ sessionId: z.string(), refs: z.array(DesignRef) }),
    result: Void,
  },
  get_session: { tier: "admin", params: SessionId, result: Session.nullable() },
} as const satisfies Record<string, CommandSpec>;
