/**
 * What a transcript shows. Claude Code leaves bookkeeping in its stream —
 * thinking-only turns, ToolSearch loading deferred tools, synthetic
 * "No response requested." stubs — that would otherwise render as blank rows
 * or empty tool cards. Every client and the gateway's transcript pages go
 * through here, so they hide the same things. Ported to Swift as
 * `TranscriptVisibility`.
 */

/** Tools that manage the agent's own context rather than do any work. */
const META_TOOL_NAMES = new Set(["ToolSearch"]);

/** Text the CLI synthesises when a turn ends without a model response. */
const META_TEXTS = new Set(["No response requested."]);

/** The result a call that will never get one shows instead. */
export const INTERRUPTED_RESULT = "Interrupted";

type ChildLike<T> =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: T };

export interface ToolCallLike<T> {
  children?: ChildLike<T>[];
  isError?: boolean;
  name?: string;
  pendingPermission?: boolean;
  result?: unknown;
}

export interface MessageLike<T> {
  images?: unknown[];
  isError?: boolean;
  role?: string;
  textBlocks?: string[];
  toolCalls?: T[];
}

export interface VisibilityOptions {
  /**
   * The agent is gone (stopped, or a saved chat), so a call without a result
   * never gets one and shows as interrupted rather than forever running.
   */
  settled?: boolean;
}

export function isMetaText(text: string): boolean {
  // Saved snapshots and odd stream blocks can carry a missing text.
  const trimmed = (text ?? "").trim();

  return trimmed.length === 0 || META_TEXTS.has(trimmed);
}

/** Context bookkeeping, or a nameless block (a sub-agent's thinking). */
export function isMetaToolCall(tc: ToolCallLike<unknown>): boolean {
  if (tc.pendingPermission) {
    return false;
  }

  return !tc.name || META_TOOL_NAMES.has(tc.name);
}

/** The call as shown, or null when it is bookkeeping. Unchanged → same object. */
export function visibleToolCall<T extends ToolCallLike<T>>(
  tc: T,
  options: VisibilityOptions = {},
): T | null {
  if (isMetaToolCall(tc)) {
    return null;
  }
  let next = tc;
  if (tc.children) {
    const children = visibleChildren(tc.children, options);
    if (children !== tc.children) {
      next = { ...next, children };
    }
  }
  if (options.settled && tc.result == null && !tc.pendingPermission) {
    next = { ...next, result: INTERRUPTED_RESULT, isError: true };
  }

  return next;
}

function visibleChildren<T extends ToolCallLike<T>>(
  children: ChildLike<T>[],
  options: VisibilityOptions,
): ChildLike<T>[] {
  let changed = false;
  const out: ChildLike<T>[] = [];
  for (const child of children) {
    if (child.kind === "text") {
      if (isMetaText(child.text)) {
        changed = true;
      } else {
        out.push(child);
      }
      continue;
    }
    const call = visibleToolCall(child.toolCall, options);
    if (call !== child.toolCall) {
      changed = true;
    }
    if (call) {
      out.push(call === child.toolCall ? child : { ...child, toolCall: call });
    }
  }

  return changed ? out : children;
}

/** The message as shown, or null when nothing in it is. Unchanged → same object. */
export function visibleMessage<
  M extends MessageLike<T>,
  T extends ToolCallLike<T>,
>(m: M, options: VisibilityOptions = {}): M | null {
  const textBlocks = m.textBlocks ?? [];
  const toolCalls = m.toolCalls ?? [];
  const keptText =
    m.role === "user" ? textBlocks : textBlocks.filter((t) => !isMetaText(t));
  let callsChanged = false;
  const keptCalls: T[] = [];
  for (const tc of toolCalls) {
    const call = visibleToolCall(tc, options);
    if (call !== tc) {
      callsChanged = true;
    }
    if (call) {
      keptCalls.push(call);
    }
  }
  const hasContent =
    keptText.some((t) => t.trim().length > 0) ||
    keptCalls.length > 0 ||
    (m.images?.length ?? 0) > 0 ||
    m.isError === true;
  if (!hasContent) {
    return null;
  }
  if (keptText.length === textBlocks.length && !callsChanged) {
    return m;
  }

  return { ...m, textBlocks: keptText, toolCalls: keptCalls };
}

// Stripped copies are cached per source message so a re-render hands memoized
// rows the same object.
const cache = {
  live: new WeakMap<object, unknown>(),
  settled: new WeakMap<object, unknown>(),
};

/** The transcript as shown. Same array when nothing is hidden or stripped. */
export function visibleMessages<
  M extends MessageLike<T>,
  T extends ToolCallLike<T>,
>(messages: M[], options: VisibilityOptions = {}): M[] {
  const memo = options.settled ? cache.settled : cache.live;
  let changed = false;
  const out: M[] = [];
  for (const m of messages) {
    let shown: M | null;
    if (memo.has(m)) {
      shown = memo.get(m) as M | null;
    } else {
      shown = visibleMessage<M, T>(m, options);
      memo.set(m, shown);
    }
    if (shown !== m) {
      changed = true;
    }
    if (shown) {
      out.push(shown);
    }
  }

  return changed ? out : messages;
}
