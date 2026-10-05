/**
 * The task and todo lists an agent keeps through its TodoWrite and Task* tool
 * calls, folded from those calls' inputs and results.
 */

import type {
  ConversationMessage,
  Task,
  TodoItem,
  ToolCallInfo,
} from "./types";

export function extractTodos(toolCalls: ToolCallInfo[]): TodoItem[] | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const tc = toolCalls[i];
    if (tc.name !== "TodoWrite") {
      continue;
    }
    const todos = (tc.input as { todos?: unknown }).todos;
    if (Array.isArray(todos)) {
      return todos as TodoItem[];
    }
  }

  return null;
}

export function findLatestTodosInMessages(
  messages: ConversationMessage[],
): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const todos = extractTodos(messages[i].toolCalls);
    if (todos) {
      return todos;
    }
  }

  return null;
}

export const TASK_TOOL_NAMES = new Set([
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
]);

function resultText(result: ToolCallInfo["result"] | undefined): string | null {
  if (!result) {
    return null;
  }
  if (typeof result === "string") {
    return result;
  }
  const parts: string[] = [];
  for (const block of result) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

function tryParseJson(text: string | null): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerceStatus(raw: unknown): Task["status"] | "deleted" | null {
  if (raw === "completed" || raw === "in_progress" || raw === "pending") {
    return raw;
  }
  if (raw === "deleted") {
    return "deleted";
  }

  return null;
}

function coerceTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const subject = typeof r.subject === "string" ? r.subject : null;
  if (!id || !subject) {
    return null;
  }
  const status = coerceStatus(r.status) ?? "pending";
  if (status === "deleted") {
    return null;
  }

  return {
    id,
    subject,
    status,
    description: typeof r.description === "string" ? r.description : undefined,
    activeForm: typeof r.activeForm === "string" ? r.activeForm : undefined,
    owner: typeof r.owner === "string" ? r.owner : undefined,
    blocks: Array.isArray(r.blocks)
      ? (r.blocks.filter((x) => typeof x === "string") as string[])
      : undefined,
    blockedBy: Array.isArray(r.blockedBy)
      ? (r.blockedBy.filter((x) => typeof x === "string") as string[])
      : undefined,
    metadata:
      r.metadata && typeof r.metadata === "object"
        ? (r.metadata as Record<string, unknown>)
        : undefined,
  };
}

function upsertTask(tasks: Map<string, Task>, order: string[], task: Task) {
  if (!tasks.has(task.id)) {
    order.push(task.id);
  }
  tasks.set(task.id, { ...tasks.get(task.id), ...task });
}

function deleteTask(tasks: Map<string, Task>, order: string[], id: string) {
  if (tasks.delete(id)) {
    const idx = order.indexOf(id);
    if (idx !== -1) {
      order.splice(idx, 1);
    }
  }
}

/**
 * Resolve a `TaskCreate` tool call to a `Task` object. The id can live in
 * one of two places:
 *  - the parsed JSON result (when the harness echoes a full task back), or
 *  - the result text `"Task #<id> created successfully: ..."` (regex), in
 *    which case we synthesize the rest from the input.
 *
 * Returns `null` if neither path yields enough to build a task.
 */
function coerceTaskFromCreateCall(tc: ToolCallInfo): Task | null {
  if (tc.name !== "TaskCreate") {
    return null;
  }
  const parsedResult = tryParseJson(resultText(tc.result));
  const fromResult = coerceTask(parsedResult);
  if (fromResult) {
    return fromResult;
  }
  const input = tc.input as {
    activeForm?: unknown;
    description?: unknown;
    subject?: unknown;
  };
  const subject = typeof input.subject === "string" ? input.subject : null;
  if (!subject) {
    return null;
  }
  const idMatch = (resultText(tc.result) ?? "").match(/Task #(\S+) created/);
  const id = idMatch?.[1] ?? `pending:${tc.id}`;

  return {
    id,
    subject,
    status: "pending",
    description:
      typeof input.description === "string" ? input.description : undefined,
    activeForm:
      typeof input.activeForm === "string" ? input.activeForm : undefined,
  };
}

/**
 * Walk the agent's message history looking for the `TaskCreate` whose
 * resolved id matches `taskId`. Used to recover a single task entry when a
 * later `TaskUpdate` fires for an id that's missing from the live map
 * (typically because the user cleared the task list in between).
 */
function findTaskCreateForId(
  messages: ConversationMessage[],
  taskId: string,
): Task | null {
  const walk = (calls: ToolCallInfo[]): Task | null => {
    for (const tc of calls) {
      if (tc.name === "TaskCreate") {
        const t = coerceTaskFromCreateCall(tc);
        if (t && t.id === taskId) {
          return t;
        }
      }
      if (tc.children) {
        for (const child of tc.children) {
          if (child.kind === "tool_use") {
            const found = walk([child.toolCall]);
            if (found) {
              return found;
            }
          }
        }
      }
    }

    return null;
  };

  for (const msg of messages) {
    const found = walk(msg.toolCalls);
    if (found) {
      return found;
    }
  }

  return null;
}

function applyTaskCall(
  tc: ToolCallInfo,
  tasks: Map<string, Task>,
  order: string[],
  messages?: ConversationMessage[],
) {
  const parsedResult = tryParseJson(resultText(tc.result));

  if (tc.name === "TaskList") {
    // Authoritative snapshot when the agent calls TaskList. Replace everything
    // it returns; keep any locally-tracked tasks not in the snapshot (they may
    // have been created by a sibling call not yet folded).
    if (Array.isArray(parsedResult)) {
      for (const raw of parsedResult) {
        const t = coerceTask(raw);
        if (t) {
          upsertTask(tasks, order, t);
        }
      }
    }

    return;
  }

  if (tc.name === "TaskGet") {
    const t = coerceTask(parsedResult);
    if (t) {
      upsertTask(tasks, order, t);
    }

    return;
  }

  if (tc.name === "TaskCreate") {
    const created = coerceTaskFromCreateCall(tc);
    if (created) {
      upsertTask(tasks, order, created);
    }

    return;
  }

  if (tc.name === "TaskUpdate") {
    const input = tc.input as {
      activeForm?: unknown;
      addBlockedBy?: unknown;
      addBlocks?: unknown;
      description?: unknown;
      owner?: unknown;
      status?: unknown;
      subject?: unknown;
      taskId?: unknown;
    };
    const taskId = typeof input.taskId === "string" ? input.taskId : null;
    if (!taskId) {
      return;
    }
    const status = coerceStatus(input.status);
    if (status === "deleted") {
      deleteTask(tasks, order, taskId);

      return;
    }
    let existing = tasks.get(taskId);
    if (!existing && messages) {
      // The task was likely cleared by the user; recover just this one entry
      // from the originating TaskCreate in history so the update merges onto
      // a real subject instead of fabricating a row labelled with the raw id.
      const recovered = findTaskCreateForId(messages, taskId);
      if (!recovered) {
        return;
      }
      upsertTask(tasks, order, recovered);
      existing = tasks.get(taskId);
    } else if (!existing) {
      return;
    }
    const merged: Task = {
      id: taskId,
      subject:
        typeof input.subject === "string"
          ? input.subject
          : (existing?.subject ?? taskId),
      status: status ?? existing?.status ?? "pending",
      description:
        typeof input.description === "string"
          ? input.description
          : existing?.description,
      activeForm:
        typeof input.activeForm === "string"
          ? input.activeForm
          : existing?.activeForm,
      owner: typeof input.owner === "string" ? input.owner : existing?.owner,
      blocks: Array.isArray(input.addBlocks)
        ? [
            ...(existing?.blocks ?? []),
            ...(input.addBlocks.filter(
              (x) => typeof x === "string",
            ) as string[]),
          ]
        : existing?.blocks,
      blockedBy: Array.isArray(input.addBlockedBy)
        ? [
            ...(existing?.blockedBy ?? []),
            ...(input.addBlockedBy.filter(
              (x) => typeof x === "string",
            ) as string[]),
          ]
        : existing?.blockedBy,
    };
    upsertTask(tasks, order, merged);
  }
}

export function extractTasksFromMessages(messages: ConversationMessage[]): {
  order: string[];
  tasks: Record<string, Task>;
} | null {
  const tasks = new Map<string, Task>();
  const order: string[] = [];
  let sawAny = false;

  const walk = (calls: ToolCallInfo[]) => {
    for (const tc of calls) {
      if (TASK_TOOL_NAMES.has(tc.name)) {
        sawAny = true;
        applyTaskCall(tc, tasks, order);
      }
      if (tc.children) {
        for (const child of tc.children) {
          if (child.kind === "tool_use") {
            walk([child.toolCall]);
          }
        }
      }
    }
  };

  for (const msg of messages) {
    walk(msg.toolCalls);
  }

  if (!sawAny) {
    return null;
  }

  return { tasks: Object.fromEntries(tasks), order };
}

/**
 * Apply a batch of Task* tool calls on top of the existing snapshot. Used on
 * the live event path so the task list updates incrementally — never by
 * re-deriving from full message history, which would resurrect entries the
 * user has explicitly cleared.
 */
export function applyTaskCallsLive(
  existingTasks: Record<string, Task> | null | undefined,
  existingOrder: string[] | undefined,
  calls: ToolCallInfo[],
  messages?: ConversationMessage[],
): { order: string[]; tasks: Record<string, Task> } | null {
  if (calls.length === 0) {
    return null;
  }
  const tasks = new Map<string, Task>(Object.entries(existingTasks ?? {}));
  const order = [...(existingOrder ?? [])];
  for (const tc of calls) {
    applyTaskCall(tc, tasks, order, messages);
  }

  return { tasks: Object.fromEntries(tasks), order };
}
