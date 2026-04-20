import { useSyncExternalStore } from "react";

export const AGENT_DRAG_MIME = "application/x-argus-agent-id";

export function readDraggedAgentId(dataTransfer: DataTransfer): string | null {
  const id =
    dataTransfer.getData(AGENT_DRAG_MIME) || dataTransfer.getData("text/plain");

  return id || null;
}

export function isAgentDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(AGENT_DRAG_MIME);
}

// ---------------------------------------------------------------------------
// Global "agent drag in progress" signal.
//
// Browser drag events can't be relied on to unambiguously flag that a drag
// ended on the drop targets themselves — dragleave misses when the drag ends
// outside the viewport, is cancelled with Esc, or drops on an element that
// stops propagation. Instead, the dragging tab toggles this shared flag in
// its own dragstart / dragend (which always fires, even for cancelled
// drags). Drop zones subscribe and only show their overlay while true.
// ---------------------------------------------------------------------------

let draggingAgentId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) {
    l();
  }
}

export function beginAgentDrag(agentId: string): void {
  draggingAgentId = agentId;
  notify();
}

export function endAgentDrag(): void {
  if (draggingAgentId === null) {
    return;
  }
  draggingAgentId = null;
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);

  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return draggingAgentId;
}

/** Returns the id of the agent currently being dragged, or null. */
export function useDraggingAgentId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
