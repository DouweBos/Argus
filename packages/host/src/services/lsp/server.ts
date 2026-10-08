/**
 * One running language server: the child process, the JSON-RPC connection,
 * the initialize handshake, and the server-to-client requests a real editor
 * has to answer. Knows nothing about sessions or refcounts — the manager does.
 */

import type { ResolvedServer } from "./servers";
import { type ChildProcess, spawn } from "node:child_process";
import {
  ApplyWorkspaceEditRequest,
  CancellationTokenSource,
  ConfigurationRequest,
  createProtocolConnection,
  DidChangeConfigurationNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
  type ServerCapabilities,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
  type WorkspaceEdit,
  WorkspaceFoldersRequest,
} from "vscode-languageserver-protocol/node";
import { CLIENT_CAPABILITIES } from "./capabilities";
import { toUri } from "./convert";

export const INITIALIZE_TIMEOUT_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 15_000;
const SHUTDOWN_GRACE_MS = 1500;

const ACCEPTED_REQUESTS = [
  "client/registerCapability",
  "client/unregisterCapability",
  "window/workDoneProgress/create",
  "window/showMessageRequest",
  "window/showDocument",
  "workspace/codeLens/refresh",
  "workspace/diagnostic/refresh",
  "workspace/foldingRange/refresh",
  "workspace/inlayHint/refresh",
  "workspace/inlineValue/refresh",
  "workspace/semanticTokens/refresh",
];

export interface ServerProcessOptions {
  resolved: ResolvedServer;
  root: string;
  settings?: Record<string, unknown>;
  onDiagnostics: (params: PublishDiagnosticsParams) => void;
  /** The process went away without being asked to. */
  onCrash: (detail: string) => void;
}

function lookup(settings: Record<string, unknown>, section?: string): unknown {
  if (!section) {
    return settings;
  }
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (!value || typeof value !== "object") {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }

  return value ?? null;
}

export class ServerProcess {
  readonly child: ChildProcess;
  private readonly connection: ProtocolConnection;
  capabilities: ServerCapabilities = {};
  private stopping = false;
  private exited = false;
  private stderrTail = "";
  /** Edits the server asks us to apply while a code action runs. */
  private applyCollector: WorkspaceEdit[] | null = null;

  constructor(private readonly options: ServerProcessOptions) {
    const { resolved, root } = options;
    this.child = spawn(resolved.command, resolved.args, {
      cwd: root,
      env: { ...process.env, ...resolved.env },
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so stopping it reaches tsserver and friends.
      detached: true,
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-2000);
    });
    this.child.stdin?.on("error", () => undefined);
    this.connection = createProtocolConnection(
      new StreamMessageReader(this.child.stdout!),
      new StreamMessageWriter(this.child.stdin!),
    );
    this.child.once("exit", (code, signal) => {
      this.exited = true;
      this.connection.dispose();
      if (!this.stopping) {
        options.onCrash(
          `exited ${signal ?? code}${this.stderrTail ? `: ${this.lastError()}` : ""}`,
        );
      }
    });
    this.child.once("error", (err) => {
      this.exited = true;
      if (!this.stopping) {
        options.onCrash(err.message);
      }
    });
    this.wire();
    this.connection.listen();
  }

  private lastError(): string {
    return this.stderrTail.trim().split("\n").slice(-1)[0]?.slice(0, 200) ?? "";
  }

  private wire(): void {
    const settings = this.options.settings ?? {};
    const c = this.connection;
    c.onNotification(PublishDiagnosticsNotification.type, (params) =>
      this.options.onDiagnostics(params),
    );
    c.onRequest(ConfigurationRequest.type, (params) =>
      params.items.map((item) => lookup(settings, item.section)),
    );
    c.onRequest(WorkspaceFoldersRequest.type, () => [
      { uri: toUri(this.options.root), name: "workspace" },
    ]);
    c.onRequest(ApplyWorkspaceEditRequest.type, (params) => {
      if (!this.applyCollector) {
        return { applied: false, failureReason: "Not executing an action" };
      }
      this.applyCollector.push(params.edit);

      return { applied: true };
    });
    // Registrations, progress tokens, prompts, refreshes: accepted, ignored.
    for (const method of ACCEPTED_REQUESTS) {
      c.onRequest(method, () => null);
    }
    c.onUnhandledNotification(() => undefined);
  }

  get alive(): boolean {
    return !this.exited;
  }

  /** How the server wants `didChange`: full text, incremental, or not at all. */
  get syncKind(): TextDocumentSyncKind {
    const sync = this.capabilities.textDocumentSync;
    if (typeof sync === "number") {
      return sync;
    }

    return sync?.change ?? TextDocumentSyncKind.None;
  }

  async initialize(): Promise<InitializeResult> {
    const rootUri = toUri(this.options.root);
    const result = await this.request<InitializeResult>(
      InitializeRequest.type,
      {
        processId: process.pid,
        clientInfo: { name: "Argus" },
        rootUri,
        rootPath: this.options.root,
        workspaceFolders: [{ uri: rootUri, name: "workspace" }],
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: this.options.resolved.initializationOptions,
      },
      INITIALIZE_TIMEOUT_MS,
    );
    this.capabilities = result.capabilities;
    await this.connection.sendNotification(InitializedNotification.type, {});
    if (this.options.settings) {
      await this.connection.sendNotification(
        DidChangeConfigurationNotification.type,
        { settings: this.options.settings },
      );
    }

    return result;
  }

  /** A request that gives up (and cancels) after `timeoutMs`. */
  async request<R>(
    type: { method: string },
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<R> {
    const source = new CancellationTokenSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        source.cancel();
        reject(new Error(`${type.method} timed out`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        this.connection.sendRequest<R>(type.method, params, source.token),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
      source.dispose();
    }
  }

  notify(type: { method: string }, params: unknown): void {
    if (this.exited) {
      return;
    }
    this.connection
      .sendNotification(type.method, params)
      .catch(() => undefined);
  }

  /** Run `fn`, returning every `workspace/applyEdit` the server sent meanwhile. */
  async collectAppliedEdits(
    fn: () => Promise<unknown>,
  ): Promise<WorkspaceEdit[]> {
    const collected: WorkspaceEdit[] = [];
    this.applyCollector = collected;
    try {
      await fn();
    } finally {
      this.applyCollector = null;
    }

    return collected;
  }

  private signal(sig: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (!pid || this.exited) {
      return;
    }
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        this.child.kill(sig);
      } catch {
        // Already gone.
      }
    }
  }

  /** Ask politely, then make sure. Resolves once it's gone or abandoned. */
  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    if (this.exited) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
    });
    try {
      await this.request(ShutdownRequest.type, undefined, SHUTDOWN_GRACE_MS);
      this.notify(ExitNotification.type, undefined);
    } catch {
      // Unresponsive: straight to signals.
    }
    const timer = setTimeout(() => this.signal("SIGKILL"), SHUTDOWN_GRACE_MS);
    timer.unref();
    this.signal("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) =>
        setTimeout(resolve, SHUTDOWN_GRACE_MS * 2).unref(),
      ),
    ]);
    clearTimeout(timer);
  }

  /** No handshake: for host shutdown and session deletion. */
  kill(): void {
    this.stopping = true;
    this.signal("SIGTERM");
    const timer = setTimeout(() => this.signal("SIGKILL"), SHUTDOWN_GRACE_MS);
    timer.unref();
  }
}
