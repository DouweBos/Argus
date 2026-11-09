import type {
  CreateTaskOptions,
  TaskStore,
} from "@modelcontextprotocol/sdk/experimental/tasks";
import { isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks";
import type {
  Request,
  RequestId,
  Result,
  Task,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "node:crypto";

/** How often a task-aware client is told to poll `tasks/get`. */
export const CLIENT_POLL_INTERVAL_MS = 2_000;
/**
 * The SDK answers a plain (non-task) call to a task tool by polling the store
 * in-process; keep that loop tight so blocking callers see no added latency.
 */
export const INTERNAL_POLL_INTERVAL_MS = 50;
/** How long a finished task's result stays readable when the client set no TTL. */
export const DEFAULT_RETENTION_MS = 60 * 60_000;

interface StoredTask {
  task: Task;
  sessionId?: string;
  /** The client asked for a task (`params.task`) rather than a plain call. */
  augmented: boolean;
  retentionMs: number;
  result?: Result;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * In-memory task store for one MCP connection. Unlike the SDK's, the TTL only
 * starts once a task finishes: a `wait_for_agent` can outlive any TTL a client
 * picks, and its task must not vanish mid-wait.
 */
export class ArgusTaskStore implements TaskStore {
  private readonly tasks = new Map<string, StoredTask>();

  async createTask(
    params: CreateTaskOptions,
    _requestId: RequestId,
    request: Request,
    sessionId?: string,
  ): Promise<Task> {
    const taskId = crypto.randomUUID();
    const augmented = Boolean(
      (request.params as { task?: unknown } | undefined)?.task,
    );
    const now = new Date().toISOString();
    const task: Task = {
      taskId,
      status: "working",
      ttl: params.ttl ?? null,
      createdAt: now,
      lastUpdatedAt: now,
      pollInterval: augmented
        ? (params.pollInterval ?? CLIENT_POLL_INTERVAL_MS)
        : INTERNAL_POLL_INTERVAL_MS,
    };
    this.tasks.set(taskId, {
      task,
      sessionId,
      augmented,
      retentionMs: params.ttl ?? DEFAULT_RETENTION_MS,
    });

    return { ...task };
  }

  async getTask(taskId: string, sessionId?: string): Promise<Task | null> {
    const stored = this.lookup(taskId, sessionId);

    return stored ? { ...stored.task } : null;
  }

  async storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: Result,
    sessionId?: string,
  ): Promise<void> {
    const stored = this.require(taskId, sessionId);
    if (isTerminal(stored.task.status)) {
      throw new Error(
        `Task ${taskId} is already ${stored.task.status}; its result was not stored.`,
      );
    }
    stored.result = result;
    this.transition(taskId, stored, status);
  }

  async getTaskResult(taskId: string, sessionId?: string): Promise<Result> {
    const stored = this.require(taskId, sessionId);
    if (!stored.result) {
      throw new Error(`Task ${taskId} has no result yet`);
    }

    return stored.result;
  }

  async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    const stored = this.require(taskId, sessionId);
    if (isTerminal(stored.task.status)) {
      throw new Error(
        `Task ${taskId} is already ${stored.task.status} and cannot become ${status}.`,
      );
    }
    if (statusMessage) {
      stored.task.statusMessage = statusMessage;
    }
    this.transition(taskId, stored, status);
  }

  async listTasks(
    _cursor?: string,
    sessionId?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    const tasks = [...this.tasks.keys()]
      .map((id) => this.lookup(id, sessionId))
      .filter((s): s is StoredTask => s !== undefined)
      .map((s) => ({ ...s.task }));

    return { tasks };
  }

  /** Whether the client asked for this as a task (vs. the SDK's blocking fallback). */
  isAugmented(taskId: string): boolean {
    return this.tasks.get(taskId)?.augmented ?? false;
  }

  /** Drop every task and timer — the connection is gone. */
  clear(): void {
    for (const stored of this.tasks.values()) {
      clearTimeout(stored.timer);
    }
    this.tasks.clear();
  }

  private transition(
    taskId: string,
    stored: StoredTask,
    status: Task["status"],
  ) {
    stored.task.status = status;
    stored.task.lastUpdatedAt = new Date().toISOString();
    if (isTerminal(status)) {
      clearTimeout(stored.timer);
      stored.timer = setTimeout(
        () => this.tasks.delete(taskId),
        stored.retentionMs,
      );
      stored.timer.unref?.();
    }
  }

  private lookup(taskId: string, sessionId?: string): StoredTask | undefined {
    const stored = this.tasks.get(taskId);
    if (
      stored &&
      sessionId !== undefined &&
      stored.sessionId !== undefined &&
      stored.sessionId !== sessionId
    ) {
      return undefined;
    }

    return stored;
  }

  private require(taskId: string, sessionId?: string): StoredTask {
    const stored = this.lookup(taskId, sessionId);
    if (!stored) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return stored;
  }
}
