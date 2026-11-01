/**
 * What a list screen shows in place of its rows, so "still loading" and
 * "nothing there" never look the same. Port of ArgusCore's `LoadPhase`.
 */
export type LoadPhase =
  /** Rows to show; a failed refresh behind them is the screen's banner. */
  | { kind: "content" }
  /** A load answered with nothing. */
  | { kind: "empty" }
  /** Nothing to show and the last load failed. */
  | { kind: "failed"; error: string }
  /** No load has answered yet. */
  | { kind: "loading" };

/** What a list store keeps per list, so screens can derive a {@link LoadPhase}. */
export interface LoadState {
  /** A load has settled, successfully or not. */
  loaded: boolean;
  /** The last load's failure, cleared by the next success. */
  error: string | null;
}

export const INITIAL_LOAD: LoadState = { loaded: false, error: null };

/** Rows already on screen always win, so a background refresh never hides them. */
export function loadPhase(state: LoadState, isEmpty: boolean): LoadPhase {
  if (!isEmpty) {
    return { kind: "content" };
  }
  if (state.error !== null) {
    return { kind: "failed", error: state.error };
  }

  return state.loaded ? { kind: "empty" } : { kind: "loading" };
}
