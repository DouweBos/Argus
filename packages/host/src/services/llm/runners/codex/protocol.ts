/**
 * The subset of the `codex app-server` v2 protocol the runner speaks.
 * Hand-copied from `codex app-server generate-ts` (codex-cli 0.167); fields
 * we don't read are left out, and everything is read defensively because the
 * protocol is still marked experimental.
 */

export type CodexApprovalPolicy =
  | "never"
  | "on-failure"
  | "on-request"
  | "untrusted";

export type CodexSandboxMode =
  | "danger-full-access"
  | "read-only"
  | "workspace-write";

export type CodexUserInput =
  | { type: "localImage"; path: string }
  | { type: "text"; text: string; text_elements: [] };

export interface CodexTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexThreadTokenUsage {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface CodexFileChange {
  path: string;
  kind: { type: "add" | "delete" | "update"; move_path?: string | null };
  diff: string;
}

/** Thread items Argus renders; every other type is ignored. */
export type CodexThreadItem =
  | {
      type: "agentMessage";
      id: string;
      text: string;
    }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: "completed" | "declined" | "failed" | "inProgress";
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      tool: string;
      arguments: unknown;
      status: string;
      contentItems: unknown[] | null;
      success: boolean | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: CodexFileChange[];
      status: "completed" | "declined" | "failed" | "inProgress";
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: "completed" | "failed" | "inProgress";
      arguments: unknown;
      result: { content: unknown[] } | null;
      error: { message: string } | null;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "userMessage"; id: string }
  | { type: "webSearch"; id: string; query?: string };

export interface CodexTurn {
  id: string;
  status: "completed" | "failed" | "inProgress" | "interrupted";
  error: { message: string } | null;
  durationMs: number | null;
}

/** A turn as `thread/read` returns it with `includeTurns`. */
export interface CodexTurnWithItems {
  id: string;
  status: CodexTurn["status"];
  items?: { type: string }[];
}

export interface CodexThreadReadResponse {
  thread: { id: string; turns?: CodexTurnWithItems[] };
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}

export interface CodexThreadResponse {
  thread: { id: string };
  model: string;
  reasoningEffort: string | null;
}

export interface CodexCommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
}

export interface CodexFileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface CodexMcpServerStatus {
  name: string;
  runtimeStatus: string | null;
  tools: Record<string, unknown>;
  toolsError: string | null;
}
