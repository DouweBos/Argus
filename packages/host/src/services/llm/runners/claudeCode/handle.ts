/**
 * Runtime handle for a single spawned Claude Code CLI subprocess.
 *
 * Owns the {@link ChildProcess}, the readline loop draining stdout, the
 * stderr drain, the {@link ControlHandler}, and the lifecycle state machine.
 * Exposes a runner-agnostic surface ({@link LlmRunnerHandle}) so the agent
 * service can drive Claude without importing CLI specifics.
 *
 * The readline loop forwards three classes of line:
 *
 * 1. `control_request` / `control_cancel_request` / `control_response` —
 *    consumed by {@link ControlHandler}. Permission requests fan out via
 *    the `permission-request` event (or are auto-approved internally).
 * 2. Anything else — forwarded verbatim as a `stream-event` line.
 *
 * Note: the Phase 0 relocation kept the existing {@link ControlHandler} and
 * protocol types unchanged; this handle simply consumes them.
 */

import type {
  ImageAttachment,
  LlmRunnerHandle,
  PermissionDecisionInput,
  PermissionPreHook,
  RunnerMcpServerStatus,
} from "../types";
import type {
  ControlRequest,
  ControlResponse,
  InitializeResponse,
} from "./protocol";
import type { ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import readline from "node:readline";
import type { Writable } from "node:stream";
import { info, warn } from "@argus/host/logger";
import { loadAppSettings } from "../../../appSettings/store";
import { capture } from "../../../telemetry/telemetry";
import { ControlHandler } from "./controlHandler";
import { DoneGate } from "./doneGate";
import { parseMcpStatus } from "./mcpStatus";
import { toClaudePermissionMode } from "./permissionModes";

export interface ClaudeCodeHandleInit {
  agentId: string;
  child: ChildProcess;
  stdin: Writable;
  combinedSystemPrompt: string;
  /** Added to every subagent's context when it starts. */
  subagentContext?: string;
  permissionPreHook?: PermissionPreHook;
}

/**
 * Permission request payload re-emitted to consumers (the agent service
 * forwards it on the existing `agent:permission:{agentId}` IPC channel).
 */
export interface PermissionRequestPayload {
  request_id: string;
  tool_input: Record<string, unknown>;
  tool_name: string;
  tool_use_id: string;
  permission_suggestions?: { type: string; tool: string; prefix?: string }[];
  title?: string;
  description?: string;
}

export interface PermissionCancelPayload {
  request_id: string;
  tool_use_id: string;
}

/**
 * Events emitted by {@link ClaudeCodeHandle}.
 *
 * `capabilities` fires once per spawn, after the CLI's initialize handshake.
 * `permission-request` and `permission-cancel` mirror the channels the
 * existing UI consumes verbatim.
 */
export type ClaudeCodeHandleEvent =
  | "capabilities"
  | "exit"
  | "permission-cancel"
  | "permission-request"
  | "stderr"
  | "stream-event";

export class ClaudeCodeHandle extends EventEmitter implements LlmRunnerHandle {
  readonly runnerId = "claude-code";
  readonly child: ChildProcess;
  private readonly stdin: Writable;
  private readonly controlHandler: ControlHandler;
  private readonly agentId: string;
  private readonly permissionPreHook: PermissionPreHook | null;
  private readonly doneGate = new DoneGate({
    // Opt-in: off until turned on in Settings.
    enabled: () => loadAppSettings().done_gate === true,
    report: (reverified) => capture("agent_done_gate", { reverified }),
  });
  private exited = false;

  constructor(init: ClaudeCodeHandleInit) {
    super();
    this.agentId = init.agentId;
    this.child = init.child;
    this.stdin = init.stdin;
    this.permissionPreHook = init.permissionPreHook ?? null;
    this.controlHandler = new ControlHandler(init.agentId, (active) =>
      this.doneGate.onStop(active),
    );
    this.wireStdioErrors();
    this.wireStderr();
    this.wireStdoutReadline();
    this.wireExit();
    // Send the initialize handshake immediately so the parent can `await
    // waitForInit()` before sending user prompts.
    const initRequest = this.controlHandler.buildInitializeRequest(
      init.combinedSystemPrompt || undefined,
      init.subagentContext || undefined,
    );
    this.safeWriteLine(initRequest);
  }

  // -------------------------------------------------------------------------
  // LlmRunnerHandle implementation
  // -------------------------------------------------------------------------

  send(message: string, images: ImageAttachment[] = []): void {
    const payload = buildUserMessagePayload(message, images);
    this.doneGate.newTurn();
    this.safeWriteLine(payload);
  }

  async interrupt(): Promise<void> {
    const [json, promise] = this.controlHandler.buildInterruptRequest();
    this.safeWriteLine(json);
    await promise;
  }

  async setModel(model: string): Promise<void> {
    const [json, promise] = this.controlHandler.buildSetModelRequest(model);
    this.safeWriteLine(json);
    await promise;
  }

  async setPermissionMode(mode: string): Promise<void> {
    const native = toClaudePermissionMode(mode) ?? mode;
    const [json, promise] =
      this.controlHandler.buildSetPermissionModeRequest(native);
    this.safeWriteLine(json);
    await promise;
  }

  async setEffort(level: string | null): Promise<void> {
    const [json, promise] = this.controlHandler.buildSetEffortRequest(level);
    this.safeWriteLine(json);
    await promise;
  }

  async mcpStatus(): Promise<RunnerMcpServerStatus[]> {
    const [json, promise] = this.controlHandler.buildMcpStatusRequest();
    this.safeWriteLine(json);

    return parseMcpStatus(await promise);
  }

  respondToPermission(decision: PermissionDecisionInput): void {
    const response = this.controlHandler.respond(
      decision.toolUseId,
      decision.decision,
      decision.allowRule,
      decision.allowAll,
      decision.denyMessage,
    );
    this.safeWriteLine(response);
  }

  initializeResponse(): InitializeResponse | null {
    return this.controlHandler.getCapabilities();
  }

  waitForInit(): Promise<void> {
    return this.controlHandler.waitForInit();
  }

  cleanup(): void {
    this.controlHandler.cleanup();
    this.doneGate.dispose();
  }

  async kill(): Promise<void> {
    if (this.child.exitCode !== null || this.child.killed) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      const onExit = () => resolve();
      this.child.once("exit", onExit);
      this.child.once("close", onExit);
    });
    try {
      this.child.kill();
    } catch (e) {
      info(`[agent:${this.agentId}] child.kill() returned: ${String(e)}`);
    }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    // Backstop: if SIGTERM didn't take, SIGKILL by pid. The Claude CLI
    // sometimes blocks in MCP HTTP I/O and ignores SIGTERM, leaving zombies
    // parented to Argus that keep ticking event loops.
    if (this.child.exitCode === null && this.child.pid !== undefined) {
      try {
        process.kill(this.child.pid, "SIGKILL");
      } catch {
        // ESRCH: already gone — race-resolved between the check and kill.
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  }

  // -------------------------------------------------------------------------
  // Internal: wire child stdio
  // -------------------------------------------------------------------------

  /**
   * Guarded write — silently drops writes once the pipe is gone or the
   * process has exited. Mirrors the previous behavior of `safeWrite` in
   * `claude.ts` minus the AppState gate (the agent service applies that
   * gate before invoking handle methods).
   */
  private safeWriteLine(data: string): void {
    if (this.exited) {
      return;
    }
    if (this.stdin.destroyed || this.stdin.writableEnded) {
      return;
    }
    try {
      this.stdin.write(data + "\n");
    } catch (e) {
      info(`[agent:${this.agentId}] stdin write failed: ${String(e)}`);
    }
  }

  private wireStdioErrors(): void {
    this.stdin.on("error", (err) => {
      info(`[agent:${this.agentId}] stdin error: ${String(err)}`);
    });
    this.child.stdout?.on("error", (err) => {
      info(`[agent:${this.agentId}] stdout error: ${String(err)}`);
    });
    this.child.stderr?.on("error", (err) => {
      info(`[agent:${this.agentId}] stderr error: ${String(err)}`);
    });
    this.child.on("error", (err) => {
      warn(`[agent:${this.agentId}] child process error: ${String(err)}`);
    });
  }

  private wireStderr(): void {
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          warn(`[agent:${this.agentId}] stderr:`, trimmed);
          this.emit("stderr", trimmed);
        }
      }
    });
  }

  private wireExit(): void {
    this.child.on("close", (code) => {
      this.exited = true;
      const exitCode = code ?? 0;
      // Reject any in-flight control requests so awaiting callers don't hang.
      this.controlHandler.cleanup();
      this.doneGate.dispose();
      this.emit("exit", exitCode);
    });
  }

  private wireStdoutReadline(): void {
    if (!this.child.stdout) {
      return;
    }
    const rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      // Fast-path: only parse lines that look like control messages. Every
      // other line is forwarded as a raw `stream-event` and consumed by
      // the agent service / renderer.
      if (
        line.includes('"control_request"') ||
        line.includes('"control_cancel_request"') ||
        line.includes('"control_response"')
      ) {
        const handled = this.handleControlLine(line);
        if (handled) {
          return; // Don't forward consumed control messages.
        }
        // fall through — forward unrecognised lines.
      }

      this.doneGate.observeLine(line);
      this.emit("stream-event", line);
    });
  }

  /**
   * Returns `true` if the line was a control message that we consumed (so
   * the caller should not also forward it as a `stream-event`).
   */
  private handleControlLine(line: string): boolean {
    let parsed: {
      type: string;
      request_id?: string;
      request?: unknown;
      response?: unknown;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      // Malformed — let the caller forward it as a raw event.
      return false;
    }

    const emit = (channel: string, data: unknown) => {
      // Bridge the existing ControlHandler's emit-style API onto our
      // EventEmitter. `agent:permission:{id}` and
      // `agent:permission-cancel:{id}` are mapped to typed events; the
      // other (`agent:capabilities:{id}`) is also re-emitted so the agent
      // service can broadcast it on the same IPC channel as before.
      const permPrefix = `agent:permission:`;
      const permCancelPrefix = `agent:permission-cancel:`;
      const capPrefix = `agent:capabilities:`;
      if (channel.startsWith(permPrefix)) {
        this.emit("permission-request", data as PermissionRequestPayload);
      } else if (channel.startsWith(permCancelPrefix)) {
        this.emit("permission-cancel", data as PermissionCancelPayload);
      } else if (channel.startsWith(capPrefix)) {
        this.emit("capabilities", data as InitializeResponse);
      }
    };

    if (parsed.type === "control_response") {
      const consumed = this.controlHandler.handleControlResponse(
        parsed as ControlResponse,
        emit,
      );

      return consumed;
    }

    if (parsed.type === "control_request") {
      const req = parsed as ControlRequest;
      const payload = req.request;

      // Pre-hook: agent service can intercept can_use_tool to inject device
      // resolution (e.g. splice `--device <UDID>` into a Bash command), or
      // take over the request entirely.
      if (payload.subtype === "can_use_tool" && this.permissionPreHook) {
        const decision = this.permissionPreHook({
          toolName: payload.tool_name,
          toolUseId: payload.tool_use_id,
          input: payload.input,
          rawRequest: req,
          approveRaw: (jsonLine: string) => this.safeWriteLine(jsonLine),
        });
        if (decision !== null) {
          if (decision.kind === "handled") {
            return true; // Caller will eventually approve/deny.
          }
          if (decision.kind === "rewrite-input") {
            payload.input = decision.input;
            // fall through to normal handling below.
          }
        }
      }

      const autoResponse = this.controlHandler.handleControlRequest(req, emit);
      if (autoResponse) {
        this.safeWriteLine(autoResponse);
      }

      return true;
    }

    if (parsed.type === "control_cancel_request") {
      this.controlHandler.cancelRequest(parsed.request_id ?? "", emit);

      return true;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// User-message payload (Claude Code stream-json shape)
// ---------------------------------------------------------------------------

function buildUserMessagePayload(
  text: string,
  images: ImageAttachment[],
): string {
  const contentBlocks: string[] = [];
  for (const img of images) {
    const escapedMediaType = escapeJsonString(img.media_type);
    const escapedData = escapeJsonString(img.data);
    contentBlocks.push(
      `{"type":"image","source":{"type":"base64","media_type":"${escapedMediaType}","data":"${escapedData}"}}`,
    );
  }
  const escapedText = escapeJsonString(text);
  contentBlocks.push(`{"type":"text","text":"${escapedText}"}`);

  return `{"type":"user","message":{"role":"user","content":[${contentBlocks.join(",")}]}}`;
}

function escapeJsonString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = s.codePointAt(i)!;
    if (ch === '"') {
      out += '\\"';
    } else if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }

  return out;
}
