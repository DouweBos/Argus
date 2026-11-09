import type { ArgusTaskStore } from "./taskStore";
import type { EventMap } from "../../telemetryEvents";
import type { CreateTaskRequestHandlerExtra } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";

/** The tools that run as MCP tasks. */
export type TaskToolName = EventMap["mcp_task_finished"]["tool"];

/** How often a blocking call pings the client so idle timeouts don't kill it. */
const KEEPALIVE_MS = 30_000;

export interface TaskToolSpec<Shape extends ZodRawShapeCompat> {
  name: TaskToolName;
  description: string;
  shape: Shape;
  /** Progress line for blocking callers' keepalive pings. */
  progress?: (args: ShapeOutput<Shape>) => string;
  run: (args: ShapeOutput<Shape>) => Promise<CallToolResult>;
}

/**
 * Register a long-running tool as task-capable (`taskSupport: "optional"`).
 * A client that sends `params.task` gets a task handle straight away and the
 * result once `run` settles, so a waiting orchestrator isn't stuck in the
 * call. Any other client still blocks: the SDK polls the task in-process.
 */
export function registerTaskTool<Shape extends ZodRawShapeCompat>(
  server: McpServer,
  store: ArgusTaskStore,
  spec: TaskToolSpec<Shape>,
): void {
  const log = createLogger(`mcp:${spec.name}`);

  server.experimental.tasks.registerToolTask<ZodRawShapeCompat, undefined>(
    spec.name,
    {
      description: spec.description,
      inputSchema: spec.shape,
      execution: { taskSupport: "optional" },
    },
    {
      createTask: async (rawArgs, extra) => {
        // The SDK has validated `rawArgs` against `spec.shape`.
        const args = rawArgs as ShapeOutput<Shape>;
        const task = await extra.taskStore.createTask({
          ttl: extra.taskRequestedTtl,
        });
        const augmented = store.isAugmented(task.taskId);
        const stopKeepalive = augmented
          ? () => {}
          : startKeepalive(extra, spec.progress?.(args) ?? spec.name);

        settle(spec, args, log).then(async (result) => {
          stopKeepalive();
          try {
            await extra.taskStore.storeTaskResult(
              task.taskId,
              result.isError ? "failed" : "completed",
              result,
            );
            capture("mcp_task_finished", {
              tool: spec.name,
              mode: augmented ? "task" : "blocking",
              outcome: result.isError ? "failed" : "completed",
            });
          } catch {
            // Cancelled by the client, or the connection (and its store) is gone.
            capture("mcp_task_finished", {
              tool: spec.name,
              mode: augmented ? "task" : "blocking",
              outcome: "cancelled",
            });
          }
        });

        return { task };
      },
      getTask: async (_args, extra) => extra.taskStore.getTask(extra.taskId),
      getTaskResult: async (_args, extra) =>
        (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult,
    },
  );
}

/** Run the tool, turning a throw into the error result `server.tool` would give. */
async function settle<Shape extends ZodRawShapeCompat>(
  spec: TaskToolSpec<Shape>,
  args: ShapeOutput<Shape>,
  log: ReturnType<typeof createLogger>,
): Promise<CallToolResult> {
  try {
    return await spec.run(args);
  } catch (err) {
    log.error("tool handler threw:", err);

    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
}

function startKeepalive(
  extra: CreateTaskRequestHandlerExtra,
  message: string,
): () => void {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return () => {};
  }
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: ticks, message },
      })
      .catch(() => {});
  }, KEEPALIVE_MS);

  return () => clearInterval(timer);
}
