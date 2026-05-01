/**
 * Drag-and-drop framework for the Argus git sidebar.
 *
 * HTML5 drag-and-drop only — no third-party libraries.
 *
 * The internal state is a module-level singleton (no Zustand dependency in
 * Peacock) exposed via React's `useSyncExternalStore` so that the
 * `<DragLayer />` component re-renders on every state transition without
 * prop drilling.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";

/* ── Payload discriminated union ───────────────────────────────────────── */

export type DragPayload =
  | {
      kind: "file";
      paths: string[];
      /** Optional ref the files originate from (commit hash, `stash@{N}`,
       *  branch name). Absent for working-tree drags between staged/unstaged
       *  panes. When present, the working-copy drop target restores the paths
       *  from this ref into the working tree. */
      sourceRef?: string;
    }
  | { kind: "branch"; branchName: string; isCurrent: boolean }
  | { kind: "commit"; hash: string; subject: string }
  | { kind: "remote-branch"; branchName: string; remote: string }
  | { kind: "stash"; index: number }
  | { kind: "tag"; tagName: string };

/* ── Internal singleton state ──────────────────────────────────────────── */

interface DndState {
  /** The payload of the currently dragged item, or null when idle. */
  activePayload: DragPayload | null;
  /** Label of the drop target the cursor is currently hovering, or null. */
  hoverLabel: string | null;
  /** Stable id of the hovered drop target — used to derive `isOver` per
   *  target without false matches when two targets share the same label. */
  hoverTargetId: number | null;
  /** Alt-modifier label when ⌥ is held over a target with a modifier. */
  altLabel: string | null;
  /** Shift-modifier label when ⇧ is held over a target with a modifier. */
  shiftLabel: string | null;
  /** Whether the ⌥ key is currently held. */
  altHeld: boolean;
  /** Whether the ⇧ key is currently held. */
  shiftHeld: boolean;
}

const initialState: DndState = {
  activePayload: null,
  hoverLabel: null,
  hoverTargetId: null,
  altLabel: null,
  shiftLabel: null,
  altHeld: false,
  shiftHeld: false,
};

let _nextTargetId = 1;

let _state: DndState = { ...initialState };
const _listeners = new Set<() => void>();

function setState(patch: Partial<DndState>): void {
  _state = { ..._state, ...patch };
  for (const fn of _listeners) {
    fn();
  }
}

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);

  return () => _listeners.delete(fn);
}

function getSnapshot(): DndState {
  return _state;
}

/** Read the current singleton state — for use in the `<DragLayer />`. */
export function useDndState(): DndState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* ── useDraggable ──────────────────────────────────────────────────────── */

export interface UseDraggableOptions {
  /** Optional custom drag image factory. Returns the element to use for the
   *  drag snapshot plus the cursor offset. The element is appended to
   *  `document.body` (off-screen via inline styles), snapshot by the browser,
   *  then removed on the next frame. Use this to render a clean chip instead
   *  of the dragged element itself, which can otherwise leak borders or
   *  scrollbars into the snapshot. */
  dragImage?: () => { element: HTMLElement; x?: number; y?: number };
  onDragEnd?: () => void;
  onDragStart?: () => void;
}

export interface UseDraggableResult {
  draggable: true;
  onDragEnd: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}

/**
 * Returns HTML5 drag attributes for an element carrying the given payload.
 *
 * Usage:
 * ```tsx
 * const drag = useDraggable({ kind: "branch", branchName: "main", isCurrent: true });
 * return <div {...drag}>Main</div>;
 * ```
 */
export function useDraggable<P extends DragPayload>(
  payload: P,
  opts?: UseDraggableOptions,
): UseDraggableResult {
  // Stable reference to opts so callbacks don't need to be recreated.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const onDragStart = useCallback((e: React.DragEvent) => {
    // Serialize payload into the dataTransfer for cross-window safety.
    e.dataTransfer.setData(
      "application/argus-dnd",
      JSON.stringify(payloadRef.current),
    );
    e.dataTransfer.effectAllowed = "move";
    if (optsRef.current?.dragImage) {
      const { element, x = 0, y = 0 } = optsRef.current.dragImage();
      // Position off-screen so the user never sees the live element — the
      // browser still snapshots it for the drag image. Cleaned up on the
      // next frame; the snapshot is taken synchronously inside setDragImage.
      element.style.position = "fixed";
      element.style.top = "-1000px";
      element.style.left = "-1000px";
      element.style.pointerEvents = "none";
      document.body.appendChild(element);
      e.dataTransfer.setDragImage(element, x, y);
      requestAnimationFrame(() => element.remove());
    }
    setState({ activePayload: payloadRef.current });
    optsRef.current?.onDragStart?.();
  }, []);

  const onDragEnd = useCallback((_e: React.DragEvent) => {
    setState({ ...initialState });
    optsRef.current?.onDragEnd?.();
  }, []);

  return { draggable: true, onDragStart, onDragEnd };
}

/* ── useDropTarget ─────────────────────────────────────────────────────── */

export interface AltModifier<P extends DragPayload> {
  /** Display label, or a function deriving the label from the active payload. */
  label: string | ((payload: P) => string);
  onDrop: (payload: P) => void;
}

export interface UseDropTargetOptions<P extends DragPayload> {
  /** Payload kinds this target accepts. */
  accepts: DragPayload["kind"][];
  /** Display label shown in the DragLayer badge. May be a function of the
   *  active payload so a single drop target can show context-aware text
   *  (e.g. "Cherry-pick onto main" vs "Merge feature into main"). */
  label: string | ((payload: P) => string);
  /** Optional ⌥-/⇧-key modifiers (alternate actions with different labels).
   *  Shift takes precedence over alt when both are held. */
  modifiers?: { alt?: AltModifier<P>; shift?: AltModifier<P> };
  onDrop: (payload: P) => void;
}

export interface UseDropTargetResult {
  isOver: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Returns HTML5 drop event handlers for an element that can receive drags.
 *
 * Automatically filters by accepted payload kinds. When ⌥ is held, fires
 * the `modifiers.alt` handler instead and shows the alt label in the badge.
 */
export function useDropTarget<P extends DragPayload>(
  opts: UseDropTargetOptions<P>,
): UseDropTargetResult {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Stable id for this target instance — survives re-renders.
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) {
    idRef.current = _nextTargetId++;
  }

  // Track whether the cursor is over this specific target via enter/leave
  // counter (child elements fire extra enter/leave events).
  const enterCount = useRef(0);

  const isAccepted = useCallback((kind: string): kind is P["kind"] => {
    return (optsRef.current.accepts as string[]).includes(kind);
  }, []);

  const parsePayload = useCallback(
    (e: React.DragEvent): P | null => {
      const raw = e.dataTransfer.getData("application/argus-dnd");
      if (!raw) {
        // During dragover, dataTransfer may be protected. Fall back to
        // singleton state which was set on dragstart.
        const active = _state.activePayload;
        if (active && isAccepted(active.kind)) {
          return active as P;
        }

        return null;
      }
      try {
        const payload = JSON.parse(raw) as DragPayload;
        if (isAccepted(payload.kind)) {
          return payload as P;
        }

        return null;
      } catch {
        return null;
      }
    },
    [isAccepted],
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      // Check singleton state first (dataTransfer not readable during enter).
      const active = _state.activePayload;
      if (!active || !isAccepted(active.kind)) {
        return;
      }
      enterCount.current++;
      if (enterCount.current === 1) {
        const labelOpt = optsRef.current.label;
        const altOpt = optsRef.current.modifiers?.alt?.label ?? null;
        const shiftOpt = optsRef.current.modifiers?.shift?.label ?? null;
        const resolveModifier = (
          opt: string | ((p: P) => string) | null,
        ): string | null => {
          if (opt === null) {
            return null;
          }
          if (typeof opt === "function") {
            return opt(active as P);
          }

          return opt;
        };
        setState({
          hoverLabel:
            typeof labelOpt === "function" ? labelOpt(active as P) : labelOpt,
          hoverTargetId: idRef.current,
          altLabel: resolveModifier(altOpt),
          shiftLabel: resolveModifier(shiftOpt),
          altHeld: e.altKey,
          shiftHeld: e.shiftKey,
        });
      }
      e.preventDefault();
    },
    [isAccepted],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      const active = _state.activePayload;
      if (!active || !isAccepted(active.kind)) {
        return;
      }
      // Keep modifier state in sync as keys can be pressed/released mid-hover.
      if (_state.altHeld !== e.altKey || _state.shiftHeld !== e.shiftKey) {
        setState({ altHeld: e.altKey, shiftHeld: e.shiftKey });
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    [isAccepted],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    enterCount.current = Math.max(0, enterCount.current - 1);
    if (enterCount.current === 0) {
      setState({
        hoverLabel: null,
        hoverTargetId: null,
        altLabel: null,
        shiftLabel: null,
        altHeld: e.altKey,
        shiftHeld: e.shiftKey,
      });
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      enterCount.current = 0;
      e.preventDefault();
      setState({ ...initialState });

      const payload = parsePayload(e);
      if (!payload) {
        return;
      }

      if (e.shiftKey && optsRef.current.modifiers?.shift) {
        optsRef.current.modifiers.shift.onDrop(payload);
      } else if (e.altKey && optsRef.current.modifiers?.alt) {
        optsRef.current.modifiers.alt.onDrop(payload);
      } else {
        optsRef.current.onDrop(payload);
      }
    },
    [parsePayload],
  );

  // Derive isOver from the singleton state — this target is "over" when its
  // stable id matches the hovered target id.
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const isOver =
    state.hoverTargetId === idRef.current && state.activePayload !== null;

  return { isOver, onDragEnter, onDragOver, onDragLeave, onDrop };
}
