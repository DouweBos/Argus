/**
 * Handles the Claude Code CLI control protocol over stdin/stdout.
 *
 * Replaces the file-based {@link PermissionBroker} with native JSON messaging.
 * When the CLI sends a `control_request` with `subtype: "can_use_tool"`, this
 * handler either auto-approves via session allow-rules or forwards the request
 * to the Electron renderer for interactive approval. The response is written
 * back to the CLI's stdin as a `control_response`.
 */

import type {
  ControlRequest,
  ControlResponse,
  InitializeResponse,
  PermissionDecision,
} from "./protocol";
import {
  type AllowRule,
  parseAllowRule,
  extractSpecifier,
  globMatch,
} from "./allowRules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pending permission request awaiting user response. */
interface PendingRequest {
  requestId: string;
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** Payload emitted to the renderer as `agent:permission:{agentId}`. */
export interface PermissionRequestPayload {
  request_id: string;
  tool_input: Record<string, unknown>;
  tool_name: string;
  tool_use_id: string;
  permission_suggestions?: Array<{
    type: string;
    tool: string;
    prefix?: string;
  }>;
  title?: string;
  description?: string;
}

/** Payload emitted to the renderer as `agent:permission-cancel:{agentId}`. */
export interface PermissionCancelPayload {
  request_id: string;
  tool_use_id: string;
}

// ---------------------------------------------------------------------------
// ControlHandler
// ---------------------------------------------------------------------------

export class ControlHandler {
  /** Pending requests keyed by `request_id`. */
  private readonly pending = new Map<string, PendingRequest>();

  /** Reverse lookup: `tool_use_id` → `request_id`. */
  private readonly toolUseToRequestId = new Map<string, string>();

  /** Session-level auto-approval rules. */
  private readonly allowedRules: AllowRule[] = [];

  /** The request_id of our outbound initialize request (if pending). */
  private initializeRequestId: string | null = null;

  /** Outbound control requests awaiting a response, keyed by `request_id`. */
  private readonly outboundRequests = new Map<
    string,
    {
      resolve: (response: Record<string, unknown> | undefined) => void;
      reject: (error: string) => void;
    }
  >();

  constructor(private readonly agentId: string) {}

  // -------------------------------------------------------------------------
  // Initialize: send capabilities request, handle response
  // -------------------------------------------------------------------------

  /**
   * Build a `control_request` with `subtype: "initialize"`.
   * Returns the JSON string to write to stdin.
   */
  buildInitializeRequest(appendSystemPrompt?: string): string {
    const requestId = crypto.randomUUID();
    this.initializeRequestId = requestId;

    const request: Record<string, unknown> = {
      subtype: "initialize",
    };
    if (appendSystemPrompt) {
      request.appendSystemPrompt = appendSystemPrompt;
    }

    return JSON.stringify({
      type: "control_request",
      request_id: requestId,
      request,
    });
  }

  /**
   * Check if a `control_response` is the response to our initialize request.
   * If so, parse the capabilities and emit them to the renderer.
   *
   * @returns `true` if the response was consumed (was our init response),
   *   `false` if it's an unrelated response.
   */
  handleControlResponse(
    response: ControlResponse,
    emit: (channel: string, data: unknown) => void,
  ): boolean {
    const requestId = response.response.request_id;

    // Check if this is a response to an outbound request (set_model, etc.).
    const outbound = this.outboundRequests.get(requestId);
    if (outbound) {
      this.outboundRequests.delete(requestId);
      if (response.response.subtype === "error") {
        outbound.reject(response.response.error);
      } else {
        outbound.resolve(
          response.response.response as Record<string, unknown> | undefined,
        );
      }
      return true;
    }

    if (requestId !== this.initializeRequestId) {
      return false; // Not our response.
    }

    this.initializeRequestId = null;

    if (response.response.subtype === "error") {
      console.warn(
        `[agent:${this.agentId}] initialize failed: ${response.response.error}`,
      );
      return true;
    }

    const data = response.response.response as InitializeResponse | undefined;
    if (data) {
      const cmds = data.commands ?? [];
      const models = data.models ?? [];
      const agents = data.agents ?? [];
      console.info(
        `[agent:${this.agentId}] initialized — ` +
          `${cmds.length} commands, ${models.length} models, ${agents.length} agents`,
      );
      if (cmds.length > 0) {
        console.info(
          `[agent:${this.agentId}] commands: ${cmds.map((c) => c.name).join(", ")}`,
        );
      }
      emit(`agent:capabilities:${this.agentId}`, data);
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Inbound: process a control_request from the CLI's stdout
  // -------------------------------------------------------------------------

  /**
   * Process a `control_request` from the CLI.
   *
   * @returns A `control_response` JSON string if auto-approved, or `null` if
   *   the request was forwarded to the renderer for interactive approval.
   */
  handleControlRequest(
    request: ControlRequest,
    emit: (channel: string, data: unknown) => void,
  ): string | null {
    const payload = request.request;

    if (payload.subtype !== "can_use_tool") {
      // For non-permission control requests (initialize, elicitation, etc.)
      // respond with an empty success so the CLI doesn't hang.
      return buildControlResponse(request.request_id, {} as PermissionDecision);
    }

    const { tool_name, input, tool_use_id, permission_suggestions } = payload;

    // Check session allow-rules for auto-approval.
    const specifier = extractSpecifier(
      tool_name,
      input as Record<string, unknown>,
    );
    const isAllowed = this.allowedRules.some((rule) => {
      if (rule.tool !== tool_name) return false;
      if (rule.specifier === null) return true;
      if (specifier === null) return false;
      return globMatch(rule.specifier, specifier);
    });

    if (isAllowed) {
      return buildControlResponse(request.request_id, {
        behavior: "allow",
        updatedInput: input,
      });
    }

    // Store as pending and forward to the renderer.
    const pending: PendingRequest = {
      requestId: request.request_id,
      toolUseId: tool_use_id,
      toolName: tool_name,
      toolInput: input,
    };
    this.pending.set(request.request_id, pending);
    this.toolUseToRequestId.set(tool_use_id, request.request_id);

    const permPayload: PermissionRequestPayload = {
      request_id: request.request_id,
      tool_use_id,
      tool_name,
      tool_input: input,
      permission_suggestions,
      title: payload.title,
      description: payload.description,
    };

    emit(`agent:permission:${this.agentId}`, permPayload);

    return null; // Awaiting user response.
  }

  // -------------------------------------------------------------------------
  // Outbound: build a control_response from a user decision
  // -------------------------------------------------------------------------

  /**
   * Build a `control_response` JSON string for a user permission decision.
   *
   * Accepts `toolUseId` (the frontend's key) and maps it to the protocol's
   * `request_id` internally.
   *
   * @returns The JSON string to write to the CLI's stdin.
   * @throws string if no pending request is found for the given `toolUseId`.
   */
  respond(
    toolUseId: string,
    decision: "allow" | "deny",
    allowRule?: string,
    allowAll?: boolean,
  ): string {
    const requestId = this.toolUseToRequestId.get(toolUseId);
    if (!requestId) {
      throw `No pending permission request for tool_use_id: ${toolUseId}`;
    }

    // Register session rule if the user chose "always allow".
    if (allowAll === true && allowRule) {
      this.addAllowRule(allowRule);
    }

    // Grab toolInput before cleanup.
    const pending = this.pending.get(requestId);
    const toolInput = pending?.toolInput ?? {};

    // Clean up pending state.
    this.pending.delete(requestId);
    this.toolUseToRequestId.delete(toolUseId);

    const body: PermissionDecision =
      decision === "allow"
        ? { behavior: "allow", updatedInput: toolInput }
        : { behavior: "deny", message: "User denied" };

    return buildControlResponse(requestId, body);
  }

  // -------------------------------------------------------------------------
  // Cancel: handle control_cancel_request from the CLI
  // -------------------------------------------------------------------------

  /**
   * Handle a `control_cancel_request` — the CLI withdrew a pending permission.
   * Removes the pending entry and notifies the renderer to clear the prompt.
   */
  cancelRequest(
    requestId: string,
    emit: (channel: string, data: unknown) => void,
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;

    this.pending.delete(requestId);
    this.toolUseToRequestId.delete(pending.toolUseId);

    const cancelPayload: PermissionCancelPayload = {
      request_id: requestId,
      tool_use_id: pending.toolUseId,
    };
    emit(`agent:permission-cancel:${this.agentId}`, cancelPayload);
  }

  // -------------------------------------------------------------------------
  // Allow rules
  // -------------------------------------------------------------------------

  /** Add a session-level allow rule (e.g. `Bash(npm *)`, `Edit`). */
  addAllowRule(ruleStr: string): void {
    this.allowedRules.push(parseAllowRule(ruleStr));
  }

  // -------------------------------------------------------------------------
  // Outbound control requests: set_model, set_permission_mode
  // -------------------------------------------------------------------------

  /**
   * Build a `control_request` with `subtype: "set_model"` and track it for
   * response matching. Returns `[jsonString, promise]`.
   */
  buildSetModelRequest(
    model: string,
  ): [string, Promise<Record<string, unknown> | undefined>] {
    return this.buildOutboundRequest({ subtype: "set_model", model });
  }

  /**
   * Build a `control_request` with `subtype: "set_permission_mode"` and track
   * it for response matching. Returns `[jsonString, promise]`.
   */
  buildSetPermissionModeRequest(
    mode: string,
  ): [string, Promise<Record<string, unknown> | undefined>] {
    return this.buildOutboundRequest({ subtype: "set_permission_mode", mode });
  }

  private buildOutboundRequest(
    request: Record<string, unknown>,
  ): [string, Promise<Record<string, unknown> | undefined>] {
    const requestId = crypto.randomUUID();
    const promise = new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        this.outboundRequests.set(requestId, { resolve, reject });
      },
    );
    const json = JSON.stringify({
      type: "control_request",
      request_id: requestId,
      request,
    });
    return [json, promise];
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Clean up pending state and reject outstanding outbound requests. */
  cleanup(): void {
    this.pending.clear();
    this.toolUseToRequestId.clear();
    for (const [, entry] of this.outboundRequests) {
      entry.reject("Agent stopped");
    }
    this.outboundRequests.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a serialised `control_response` message.
 */
function buildControlResponse(
  requestId: string,
  decision: PermissionDecision,
): string {
  const response: ControlResponse = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: decision as unknown as Record<string, unknown>,
    },
  };
  return JSON.stringify(response);
}
