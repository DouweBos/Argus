/**
 * Runtime handle for one ACP agent subprocess.
 *
 * Holds one ACP session for the agent's lifetime. Prompts run one at a time
 * (ACP has no steering), so a message sent mid-turn waits for the turn to end.
 * Permission requests go through Argus's mode policy first and reach the user
 * as the same `permission-request` payload Claude Code's do.
 */

import type { AcpPreset } from "./preset";
import type {
  AcpContentBlock,
  AcpInitializeResult,
  AcpPermissionRequest,
  AcpPromptResult,
  AcpSessionResult,
  AcpSessionUpdate,
} from "./protocol";
import type { McpServers } from "../../../mcp/userConfig";
import type { InitializeResponse } from "../claudeCode/protocol";
import type { RpcId, RpcNotification, RpcRequest } from "../rpc";
import type {
  CanonicalPermissionMode,
  ImageAttachment,
  LlmRunnerHandle,
  PermissionDecisionInput,
  PermissionPreHook,
} from "../types";
import type { ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import { info, warn } from "@argus/host/logger";
import { toCanonicalPermissionMode } from "../claudeCode/permissionModes";
import { killChild } from "../killChild";
import { JsonRpcPeer, RpcError } from "../rpc";
import { AcpApprovals } from "./approvals";
import { toAcpMcpServers } from "./mcp";
import { PLAN_MODE_INSTRUCTIONS } from "./permissions";
import { ACP_AUTH_REQUIRED, ACP_PROTOCOL_VERSION } from "./protocol";
import { AcpSessionSettings } from "./settings";
import { AcpTranscript, toolUses } from "./translate";

export interface AcpHandleInit {
  agentId: string;
  child: ChildProcess;
  preset: AcpPreset;
  cwd: string;
  model: string | null;
  permissionMode: string | null;
  resumeRef: string | null;
  systemPrompt: string;
  mcpServers: McpServers;
  permissionPreHook?: PermissionPreHook;
  disallowedTools?: string[];
  clientVersion: string;
}

interface QueuedPrompt {
  message: string;
  images: ImageAttachment[];
}

const STDERR_TAIL = 20;
const AUTH_TIMEOUT_MS = 20_000;

export class AcpHandle extends EventEmitter implements LlmRunnerHandle {
  readonly runnerId: string;
  readonly child: ChildProcess;
  private readonly rpc: JsonRpcPeer;
  private readonly transcript = new AcpTranscript();
  private readonly preset: AcpPreset;
  private readonly agentId: string;
  private readonly init: Promise<void>;
  private agent: AcpInitializeResult | null = null;
  private sessionId: string | null = null;
  private model: string | null;
  private mode: CanonicalPermissionMode;
  private settings: AcpSessionSettings | null = null;
  private capabilities: InitializeResponse | null = null;
  /** `session/load` replays history as updates; Argus already has it. */
  private replaying = false;
  private systemPromptSent: boolean;
  private running = false;
  private readonly queue: QueuedPrompt[] = [];
  private readonly approvals: AcpApprovals;
  private readonly stderrTail: string[] = [];
  private exited = false;

  constructor(private readonly opts: AcpHandleInit) {
    super();
    this.preset = opts.preset;
    this.runnerId = opts.preset.id;
    this.agentId = opts.agentId;
    this.child = opts.child;
    this.model = opts.model;
    this.mode = toCanonicalPermissionMode(opts.permissionMode ?? "auto");
    // A resumed conversation already carries it; a preset may carry it in meta.
    this.systemPromptSent =
      Boolean(opts.resumeRef) ||
      !opts.systemPrompt ||
      Boolean(opts.preset.sessionMeta);
    if (!opts.child.stdin || !opts.child.stdout) {
      throw `Failed to acquire stdio pipes for agent ${opts.agentId}`;
    }
    this.rpc = new JsonRpcPeer(
      opts.child.stdin,
      opts.child.stdout,
      {
        notification: (n) => this.onNotification(n),
        request: (r) => this.onAgentRequest(r),
        malformed: (l) => info(`[agent:${this.agentId}] acp: ${l}`),
      },
      { name: opts.preset.displayName, jsonrpc: true },
    );
    this.approvals = new AcpApprovals({
      rpc: this.rpc,
      cwd: opts.cwd,
      disallowed: opts.disallowedTools ?? [],
      preHook: opts.permissionPreHook ?? null,
      noAlwaysAllow: opts.preset.noAlwaysAllow === true,
      emit: (event, payload) => this.emit(event, payload),
    });
    this.wireProcess();
    this.init = this.handshake().catch((e) => {
      const tail = this.stderrTail.join("\n");
      const message = tail ? `${String(e)}\n${tail}` : String(e);
      this.emitStderr(message);
      throw message;
    });
    // Callers that never await init still mustn't crash the host.
    this.init.catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // LlmRunnerHandle
  // -------------------------------------------------------------------------

  send(message: string, images: ImageAttachment[] = []): void {
    this.queue.push({ message, images });
    this.init.then(() => this.pump()).catch(() => undefined);
  }

  async interrupt(): Promise<void> {
    await this.init;
    if (!this.sessionId || !this.running) {
      return;
    }
    this.rpc.notify("session/cancel", {
      sessionId: this.sessionId,
      ...(this.preset.cancelMeta ? { _meta: this.preset.cancelMeta } : {}),
    });
    // ACP: every pending permission request is answered `cancelled`.
    this.approvals.cancelAll();
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    this.transcript.setModel(model);
    if (this.settings) {
      await this.settings
        .applyModel(model)
        .catch((e) =>
          this.emitStderr(`${this.preset.displayName} kept its model: ${e}`),
        );
    }
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.mode = toCanonicalPermissionMode(mode);
    await this.settings?.applyMode(this.mode);
  }

  async setEffort(): Promise<void> {
    // ACP has no portable effort setting.
  }

  respondToPermission(decision: PermissionDecisionInput): void {
    this.approvals.respond(decision);
  }

  initializeResponse(): InitializeResponse | null {
    return this.capabilities;
  }

  waitForInit(): Promise<void> {
    return this.init;
  }

  cleanup(): void {
    this.approvals.clear();
    this.queue.length = 0;
  }

  async kill(): Promise<void> {
    await killChild(this.child, this.agentId);
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  private async handshake(): Promise<void> {
    this.agent = await this.rpc.request<AcpInitializeResult>("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: "argus",
        title: "Argus",
        version: this.opts.clientVersion,
      },
      ...(this.preset.initializeMeta
        ? { _meta: this.preset.initializeMeta }
        : {}),
    });

    const caps = this.agent.agentCapabilities ?? {};
    const mcp = toAcpMcpServers(
      this.opts.mcpServers,
      caps.mcpCapabilities?.http === true,
    );
    if (mcp.skipped.length > 0) {
      warn(
        `[agent:${this.agentId}] ${this.preset.displayName} can't reach HTTP MCP servers; skipped ${mcp.skipped.join(", ")}`,
      );
    }
    const params = {
      cwd: this.opts.cwd,
      mcpServers: mcp.servers,
      ...(this.preset.sessionMeta
        ? { _meta: this.preset.sessionMeta(this.opts.systemPrompt) }
        : {}),
    };

    const session = await this.withAuth(() => this.openSession(params));
    this.sessionId = session.sessionId ?? this.opts.resumeRef;
    if (!this.sessionId) {
      throw `${this.preset.displayName} opened no session`;
    }
    this.settings = new AcpSessionSettings(
      this.rpc,
      this.preset,
      this.sessionId,
      this.agentId,
      session,
    );
    const agentModel = this.settings.currentModel();

    await this.settings.applyMode(
      this.mode,
      this.preset.setModeOnStart === true,
    );
    if (this.model && this.model !== agentModel) {
      await this.settings
        .applyModel(this.model)
        .catch((e) =>
          warn(`[agent:${this.agentId}] acp set model failed: ${String(e)}`),
        );
    }
    this.model = this.model ?? agentModel;

    for (const l of this.transcript.init(
      this.sessionId,
      this.model,
      this.mode,
    )) {
      this.emit("stream-event", l);
    }
    this.publishCapabilities();
  }

  private async openSession(params: object): Promise<AcpSessionResult> {
    const resume = this.opts.resumeRef;
    if (!resume) {
      return this.rpc.request<AcpSessionResult>("session/new", params);
    }
    const via = this.preset.resumeVia ?? this.resumeMethod();
    if (!via) {
      this.emitStderr(
        `${this.preset.displayName} can't resume a conversation; this one starts fresh.`,
      );
      this.systemPromptSent = !this.opts.systemPrompt;

      return this.rpc.request<AcpSessionResult>("session/new", params);
    }
    this.replaying = via === "load";
    try {
      return await this.rpc.request<AcpSessionResult>(`session/${via}`, {
        ...params,
        sessionId: resume,
      });
    } finally {
      this.replaying = false;
    }
  }

  /** `session/load` replays history; `session/resume` doesn't, so it's second choice. */
  private resumeMethod(): "load" | "resume" | null {
    const caps = this.agent?.agentCapabilities ?? {};
    if (caps.loadSession) {
      return "load";
    }

    return caps.sessionCapabilities?.resume ? "resume" : null;
  }

  /** Signs in through the agent's own method once, if it offers the preset's. */
  private async withAuth<T>(open: () => Promise<T>): Promise<T> {
    try {
      return await open();
    } catch (e) {
      if (!(e instanceof RpcError) || e.code !== ACP_AUTH_REQUIRED) {
        throw e;
      }
      const methodId =
        typeof this.preset.authMethodId === "function"
          ? this.preset.authMethodId()
          : this.preset.authMethodId;
      const offered = this.agent?.authMethods?.some((m) => m.id === methodId);
      if (!methodId || !offered) {
        throw `${this.preset.displayName} isn't signed in. ${this.preset.loginHint}`;
      }
      try {
        // Signed out, some agents start an interactive login and never answer.
        await Promise.race([
          this.rpc.request("authenticate", { methodId }),
          sleep(AUTH_TIMEOUT_MS).then(() => Promise.reject("timed out")),
        ]);
      } catch {
        throw `${this.preset.displayName} isn't signed in. ${this.preset.loginHint}`;
      }

      return open();
    }
  }

  private publishCapabilities(): void {
    this.capabilities = {
      commands: [],
      agents: [],
      output_style: "default",
      available_output_styles: [],
      account: {},
      models: (this.settings?.modelChoices() ?? []).map((m) => ({
        value: m.value,
        displayName: m.name,
        description: m.description ?? "",
        supportsEffort: false,
      })),
    };
    this.emit("capabilities", this.capabilities);
  }

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  private async pump(): Promise<void> {
    if (this.running || this.exited) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.running = true;
    this.emitLines(this.transcript.turnStarted());
    let result: AcpPromptResult | null = null;
    let error: string | null = null;
    try {
      result = await this.rpc.request<AcpPromptResult>("session/prompt", {
        sessionId: this.sessionId,
        prompt: this.promptBlocks(next),
      });
    } catch (e) {
      error = String(e);
    }
    this.approvals.cancelAll();
    this.emitLines(this.transcript.turnCompleted(result, error));
    this.running = false;
    await this.pump();
  }

  private promptBlocks(p: QueuedPrompt): AcpContentBlock[] {
    const blocks: AcpContentBlock[] = [];
    if (!this.systemPromptSent) {
      this.systemPromptSent = true;
      blocks.push({
        type: "text",
        text: `<system-instructions>\n${this.opts.systemPrompt}\n</system-instructions>`,
      });
    }
    if (this.mode === "plan" && !this.settings?.hasPlanMode()) {
      blocks.push({ type: "text", text: PLAN_MODE_INSTRUCTIONS });
    }
    const imageOk =
      this.agent?.agentCapabilities?.promptCapabilities?.image === true;
    if (p.images.length > 0 && !imageOk) {
      this.emitStderr(
        `${this.preset.displayName} doesn't take images; sent the text only.`,
      );
    }
    if (imageOk) {
      for (const img of p.images) {
        blocks.push({
          type: "image",
          data: img.data,
          mimeType: img.media_type,
        });
      }
    }
    blocks.push({ type: "text", text: p.message });

    return blocks;
  }

  // -------------------------------------------------------------------------
  // Agent → client
  // -------------------------------------------------------------------------

  private onNotification(n: RpcNotification): void {
    if (n.method !== "session/update" || this.replaying) {
      return;
    }
    const p = (n.params ?? {}) as {
      sessionId?: string;
      update?: AcpSessionUpdate;
    };
    if (!p.update || (this.sessionId && p.sessionId !== this.sessionId)) {
      return;
    }
    const u = p.update;
    if (u.sessionUpdate === "current_mode_update") {
      this.settings?.noteMode(u.currentModeId);
    } else if (u.sessionUpdate === "config_option_update") {
      // Some agents (Kiro) only name their models after the session opens.
      this.settings?.noteConfig(u.configOptions);
      this.publishCapabilities();
    }
    this.emitLines(this.transcript.update(u));
  }

  private onAgentRequest(r: RpcRequest): void {
    if (r.method === "session/request_permission") {
      this.askPermission(r.id, r.params as AcpPermissionRequest);

      return;
    }
    // fs/* and terminal/* were never advertised; anything else is unknown.
    this.rpc.respondError(r.id, `Argus does not handle ${r.method}`);
  }

  private askPermission(rpcId: RpcId, req: AcpPermissionRequest): void {
    this.emitLines(this.transcript.noteCall(req.toolCall));
    const call = this.transcript.call(req.toolCall.toolCallId) ?? req.toolCall;
    const use = toolUses(call)[0] ?? { name: "Tool", input: {} };
    this.approvals.ask(
      rpcId,
      req.options,
      call,
      use,
      this.transcript.cardId(call.toolCallId),
      this.mode,
    );
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
        // Agents log freely on stderr; it only matters if the handshake fails.
        if (trimmed) {
          info(`[agent:${this.agentId}] ${this.runnerId} stderr: ${trimmed}`);
          this.stderrTail.push(trimmed);
          if (this.stderrTail.length > STDERR_TAIL) {
            this.stderrTail.shift();
          }
        }
      }
    });
    this.child.on("close", (code) => {
      this.exited = true;
      this.rpc.close(`${this.preset.displayName} exited`);
      this.emit("exit", code ?? 0);
    });
  }

  private emitLines(lines: string[]): void {
    for (const l of lines) {
      this.emit("stream-event", l);
    }
  }

  private emitStderr(message: string): void {
    if (!this.exited) {
      this.emit("stderr", message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
