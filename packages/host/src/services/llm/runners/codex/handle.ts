/**
 * Runtime handle for one `codex app-server` subprocess.
 *
 * Holds one thread for the agent's lifetime. Prompts start a turn, or steer
 * the turn already running; model, effort and mode changes ride on the next
 * `turn/start`. Approval requests surface through the same
 * `permission-request` payload Claude Code's do.
 */

import type { CodexPermissions } from "./permissionModes";
import type {
  CodexCommandApprovalParams,
  CodexFileChangeApprovalParams,
  CodexMcpServerStatus,
  CodexModel,
  CodexThreadItem,
  CodexThreadResponse,
  CodexThreadTokenUsage,
  CodexTurn,
  CodexUserInput,
} from "./protocol";
import type { RpcId, RpcNotification, RpcRequest } from "./rpc";
import type { InitializeResponse } from "../claudeCode/protocol";
import type {
  ImageAttachment,
  LlmRunnerHandle,
  PermissionDecisionInput,
  PermissionPreHook,
  RunnerMcpServerStatus,
} from "../types";
import type { ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
import { toCanonicalPermissionMode } from "../claudeCode/permissionModes";
import { matchesDisallowed } from "./disallowed";
import { PLAN_MODE_INSTRUCTIONS, toCodexPermissions } from "./permissionModes";
import { CodexRpc } from "./rpc";
import { CodexTranscript, fileChangeTool, toolUses } from "./translate";

export const CODEX_RUNNER_ID = "codex";

export interface CodexHandleInit {
  agentId: string;
  child: ChildProcess;
  cwd: string;
  model: string | null;
  permissionMode: string | null;
  resumeRef: string | null;
  developerInstructions: string;
  /** `mcp_servers` in Codex's config shape, applied to the thread. */
  mcpServers: Record<string, unknown>;
  permissionPreHook?: PermissionPreHook;
  disallowedTools?: string[];
  clientVersion: string;
}

interface PendingApproval {
  rpcId: RpcId;
  toolUseId: string;
}

export class CodexHandle extends EventEmitter implements LlmRunnerHandle {
  readonly runnerId = CODEX_RUNNER_ID;
  readonly child: ChildProcess;
  private readonly rpc: CodexRpc;
  private readonly transcript = new CodexTranscript();
  private readonly agentId: string;
  private readonly preHook: PermissionPreHook | null;
  private readonly disallowed: string[];
  private readonly init: Promise<void>;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private model: string | null;
  private effort: string | null = null;
  private mode: string;
  private capabilities: InitializeResponse | null = null;
  /** Keyed by the approval's tool_use_id. */
  private readonly approvals = new Map<string, PendingApproval>();
  /** File changes seen at `item/started`, for their approval cards. */
  private readonly fileChanges = new Map<string, CodexThreadItem>();
  private exited = false;

  constructor(private readonly opts: CodexHandleInit) {
    super();
    this.agentId = opts.agentId;
    this.child = opts.child;
    this.model = opts.model;
    this.mode = toCanonicalPermissionMode(opts.permissionMode ?? "auto");
    this.preHook = opts.permissionPreHook ?? null;
    this.disallowed = opts.disallowedTools ?? [];
    if (!opts.child.stdin || !opts.child.stdout) {
      throw `Failed to acquire stdio pipes for agent ${opts.agentId}`;
    }
    this.rpc = new CodexRpc(opts.child.stdin, opts.child.stdout, {
      notification: (n) => this.onNotification(n),
      request: (r) => this.onServerRequest(r),
      malformed: (l) => warn(`[agent:${this.agentId}] codex: ${l}`),
    });
    this.wireProcess();
    this.init = this.handshake();
    // Callers that never await init still mustn't crash the host.
    this.init.catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // LlmRunnerHandle
  // -------------------------------------------------------------------------

  send(message: string, images: ImageAttachment[] = []): void {
    this.init
      .then(() => this.startOrSteer(message, images))
      .catch((e) => this.emitStderr(`Codex refused the prompt: ${String(e)}`));
  }

  async interrupt(): Promise<void> {
    await this.init;
    if (!this.threadId || !this.activeTurnId) {
      return;
    }
    await this.rpc.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    });
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    this.transcript.setModel(model);
  }

  async setPermissionMode(mode: string): Promise<void> {
    // Applies from the next turn; the agent service announces the change.
    this.mode = toCanonicalPermissionMode(mode);
  }

  async setEffort(level: string | null): Promise<void> {
    // Codex tops out at `xhigh`; Argus's `max` means the most there is.
    this.effort = level === "max" ? "xhigh" : level;
  }

  async mcpStatus(): Promise<RunnerMcpServerStatus[]> {
    await this.init;
    const res = await this.rpc.request<{ data?: CodexMcpServerStatus[] }>(
      "mcpServerStatus/list",
      {},
    );

    return (res.data ?? []).map((s) => ({
      name: s.name,
      status: s.runtimeStatus ?? "unknown",
      source: null,
      toolCount: s.tools ? Object.keys(s.tools).length : null,
      error: s.toolsError ?? null,
    }));
  }

  respondToPermission(decision: PermissionDecisionInput): void {
    const pending = this.approvals.get(decision.toolUseId);
    if (!pending) {
      return;
    }
    this.approvals.delete(decision.toolUseId);
    const remember = Boolean(decision.allowAll || decision.allowRule);
    let answer = "decline";
    if (decision.decision === "allow") {
      answer = remember ? "acceptForSession" : "accept";
    }
    this.rpc.respond(pending.rpcId, { decision: answer });
  }

  initializeResponse(): InitializeResponse | null {
    return this.capabilities;
  }

  waitForInit(): Promise<void> {
    return this.init;
  }

  cleanup(): void {
    this.approvals.clear();
    this.fileChanges.clear();
  }

  async kill(): Promise<void> {
    if (this.child.exitCode !== null || this.child.killed) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      this.child.once("close", () => resolve());
    });
    try {
      this.child.kill();
    } catch (e) {
      info(`[agent:${this.agentId}] child.kill() returned: ${String(e)}`);
    }
    await Promise.race([exited, delay(2000)]);
    if (this.child.exitCode === null && this.child.pid !== undefined) {
      try {
        process.kill(this.child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
      await Promise.race([exited, delay(1000)]);
    }
  }

  // -------------------------------------------------------------------------
  // Handshake + turns
  // -------------------------------------------------------------------------

  private async handshake(): Promise<void> {
    await this.rpc.request("initialize", {
      clientInfo: {
        name: "argus",
        title: "Argus",
        version: this.opts.clientVersion,
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.rpc.notify("initialized");

    const perms = this.permissions();
    const threadParams = {
      cwd: this.opts.cwd,
      model: this.model,
      approvalPolicy: perms.approvalPolicy,
      sandbox: perms.sandbox,
      developerInstructions: this.opts.developerInstructions || null,
      config:
        Object.keys(this.opts.mcpServers).length > 0
          ? { mcp_servers: this.opts.mcpServers }
          : null,
    };
    const thread = this.opts.resumeRef
      ? await this.rpc.request<CodexThreadResponse>("thread/resume", {
          ...threadParams,
          threadId: this.opts.resumeRef,
          excludeTurns: true,
        })
      : await this.rpc.request<CodexThreadResponse>(
          "thread/start",
          threadParams,
        );
    this.threadId = thread.thread.id;
    this.model = this.model ?? thread.model;
    for (const l of this.transcript.init(
      thread.thread.id,
      thread.model,
      this.mode,
    )) {
      this.emit("stream-event", l);
    }

    this.capabilities = await this.loadCapabilities();
    this.emit("capabilities", this.capabilities);
  }

  private async loadCapabilities(): Promise<InitializeResponse> {
    let models: CodexModel[] = [];
    try {
      const res = await this.rpc.request<{ data?: CodexModel[] }>(
        "model/list",
        {},
      );
      models = (res.data ?? []).filter((m) => !m.hidden);
    } catch (e) {
      warn(`[agent:${this.agentId}] codex model/list failed: ${String(e)}`);
    }
    models.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

    return {
      commands: [],
      agents: [],
      output_style: "default",
      available_output_styles: [],
      account: {},
      models: models.map((m) => ({
        value: m.model,
        displayName: m.displayName,
        description: m.description,
        supportsEffort: m.supportedReasoningEfforts.length > 0,
        supportedEffortLevels: m.supportedReasoningEfforts.map(
          (e) => e.reasoningEffort,
        ),
      })),
    };
  }

  private async startOrSteer(
    message: string,
    images: ImageAttachment[],
  ): Promise<void> {
    if (!this.threadId) {
      throw "no thread";
    }
    const input = this.userInput(message, images);
    if (this.activeTurnId) {
      try {
        await this.rpc.request("turn/steer", {
          threadId: this.threadId,
          input,
          expectedTurnId: this.activeTurnId,
        });

        return;
      } catch {
        // The turn ended between the check and the steer: start a new one.
      }
    }
    const perms = this.permissions();
    const res = await this.rpc.request<{ turn?: CodexTurn }>("turn/start", {
      threadId: this.threadId,
      input:
        this.mode === "plan"
          ? [textInput(PLAN_MODE_INSTRUCTIONS), ...input]
          : input,
      model: this.model,
      effort: this.effort,
      approvalPolicy: perms.approvalPolicy,
      sandboxPolicy: sandboxPolicy(perms, this.opts.cwd),
    });
    this.activeTurnId = res.turn?.id ?? this.activeTurnId;
  }

  private userInput(
    message: string,
    images: ImageAttachment[],
  ): CodexUserInput[] {
    const out: CodexUserInput[] = images.map((img) => ({
      type: "localImage",
      path: this.writeImage(img),
    }));
    out.push(textInput(message));

    return out;
  }

  /** Codex takes images by path; base64 attachments land in a temp dir. */
  private writeImage(img: ImageAttachment): string {
    const dir = path.join(os.tmpdir(), "argus-codex-images", this.agentId);
    mkdirSync(dir, { recursive: true });
    const ext = img.media_type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = path.join(dir, `${crypto.randomUUID()}.${ext}`);
    writeFileSync(file, Buffer.from(img.data, "base64"));

    return file;
  }

  private permissions(): CodexPermissions {
    return toCodexPermissions(this.mode, this.disallowed.length > 0, {
      editsDisallowed: this.disallowed.includes("Edit"),
    });
  }

  // -------------------------------------------------------------------------
  // Server → client
  // -------------------------------------------------------------------------

  private onNotification(n: RpcNotification): void {
    const p = (n.params ?? {}) as Record<string, unknown>;
    if (p.threadId !== undefined && p.threadId !== this.threadId) {
      return; // A subagent's thread: its own items aren't ours to draw.
    }
    let lines: string[] = [];
    switch (n.method) {
      case "turn/started":
        this.activeTurnId = (p.turn as CodexTurn | undefined)?.id ?? null;
        lines = this.transcript.turnStarted();
        break;
      case "turn/completed":
        this.activeTurnId = null;
        this.cancelApprovals();
        lines = this.transcript.turnCompleted(p.turn as CodexTurn);
        break;
      case "item/started": {
        const item = p.item as CodexThreadItem;
        if (item.type === "fileChange") {
          this.fileChanges.set(item.id, item);
        }
        lines = this.transcript.itemStarted(item);
        break;
      }
      case "item/completed": {
        const item = p.item as CodexThreadItem;
        this.fileChanges.delete(item.id);
        lines = this.transcript.itemCompleted(item);
        break;
      }
      case "turn/plan/updated":
        lines = this.transcript.planUpdated(
          (p.plan as Parameters<CodexTranscript["planUpdated"]>[0]) ?? [],
        );
        break;
      case "thread/tokenUsage/updated":
        this.transcript.tokenUsage(p.tokenUsage as CodexThreadTokenUsage);
        break;
      case "serverRequest/resolved":
        this.resolvedElsewhere(p.requestId as RpcId);
        break;
      case "error": {
        const err = p as { error?: { message?: string }; willRetry?: boolean };
        if (!err.willRetry) {
          this.emitStderr(err.error?.message ?? "Codex reported an error");
        }
        break;
      }
      default:
        break;
    }
    for (const l of lines) {
      this.emit("stream-event", l);
    }
  }

  private onServerRequest(r: RpcRequest): void {
    switch (r.method) {
      case "item/commandExecution/requestApproval": {
        const p = r.params as CodexCommandApprovalParams;
        this.askApproval(r.id, {
          toolUseId: p.approvalId ?? p.itemId,
          toolName: "Bash",
          input: {
            command: p.command ?? "",
            ...(p.reason ? { description: p.reason } : {}),
          },
        });

        return;
      }
      case "item/fileChange/requestApproval": {
        const p = r.params as CodexFileChangeApprovalParams;
        const item = this.fileChanges.get(p.itemId);
        const change = item?.type === "fileChange" ? item.changes[0] : null;
        const tool = change
          ? fileChangeTool(change)
          : { name: "Edit", input: { file_path: p.grantRoot ?? "" } };
        this.askApproval(r.id, {
          toolUseId: item ? (toolUses(item)[0]?.id ?? p.itemId) : p.itemId,
          toolName: tool.name,
          input: {
            ...tool.input,
            ...(p.reason ? { description: p.reason } : {}),
          },
        });

        return;
      }
      default:
        // User-input prompts, elicitations, token refreshes: nothing in Argus
        // answers these yet, and an unanswered request would stall the turn.
        this.rpc.respondError(r.id, `Argus does not handle ${r.method}`);
    }
  }

  private askApproval(
    rpcId: RpcId,
    req: {
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
    },
  ): void {
    const command =
      typeof req.input.command === "string" ? req.input.command : null;
    if (matchesDisallowed(this.disallowed, req.toolName, command)) {
      this.rpc.respond(rpcId, { decision: "decline" });

      return;
    }
    this.approvals.set(req.toolUseId, { rpcId, toolUseId: req.toolUseId });

    const decision = this.preHook?.({
      toolName: req.toolName,
      toolUseId: req.toolUseId,
      input: req.input,
      rawRequest: { request_id: req.toolUseId },
      approveRaw: (jsonLine) => this.answerFromControlResponse(req, jsonLine),
    });
    // Codex can't run a rewritten command, so a rewrite falls through to asking.
    if (decision?.kind === "handled") {
      return;
    }
    this.emit("permission-request", {
      request_id: String(rpcId),
      tool_name: req.toolName,
      tool_input: req.input,
      tool_use_id: req.toolUseId,
    });
  }

  /** The pre-hook answers in Claude's control_response; map it to a decision. */
  private answerFromControlResponse(
    req: { toolUseId: string },
    jsonLine: string,
  ): void {
    let behavior: string | undefined;
    try {
      const parsed = JSON.parse(jsonLine) as {
        response?: { response?: { behavior?: string } };
      };
      behavior = parsed.response?.response?.behavior;
    } catch {
      behavior = undefined;
    }
    this.respondToPermission({
      toolUseId: req.toolUseId,
      decision: behavior === "allow" ? "allow" : "deny",
    });
  }

  private resolvedElsewhere(rpcId: RpcId): void {
    for (const [toolUseId, pending] of this.approvals) {
      if (String(pending.rpcId) === String(rpcId)) {
        this.approvals.delete(toolUseId);
        this.emit("permission-cancel", {
          request_id: String(rpcId),
          tool_use_id: toolUseId,
        });
      }
    }
  }

  /** A finished turn leaves no approval answerable. */
  private cancelApprovals(): void {
    for (const pending of [...this.approvals.values()]) {
      this.resolvedElsewhere(pending.rpcId);
    }
  }

  // -------------------------------------------------------------------------
  // Process plumbing
  // -------------------------------------------------------------------------

  private wireProcess(): void {
    this.child.stdin?.on("error", (e) =>
      info(`[agent:${this.agentId}] stdin error: ${String(e)}`),
    );
    this.child.on("error", (e) =>
      warn(`[agent:${this.agentId}] child process error: ${String(e)}`),
    );
    this.child.stderr?.on("data", (chunk: Buffer) => {
      for (const l of chunk.toString().split("\n")) {
        const trimmed = l.trim();
        // app-server's stderr is tracing noise; real failures arrive as
        // `error` notifications and failed turns.
        if (trimmed) {
          info(`[agent:${this.agentId}] codex stderr: ${trimmed}`);
        }
      }
    });
    this.child.on("close", (code) => {
      this.exited = true;
      this.rpc.close("codex app-server exited");
      this.emit("exit", code ?? 0);
    });
  }

  private emitStderr(message: string): void {
    if (!this.exited) {
      this.emit("stderr", message);
    }
  }
}

function textInput(text: string): CodexUserInput {
  return { type: "text", text, text_elements: [] };
}

/** `turn/start` takes the sandbox as a policy object, not the mode name. */
function sandboxPolicy(perms: CodexPermissions, cwd: string): object {
  switch (perms.sandbox) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    default:
      return {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
