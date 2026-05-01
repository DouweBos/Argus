/**
 * Persisted "favorite" branches per project (Phase 6 P2/P3).
 *
 * Stored in localStorage under `argus:git-favorites`. Keyed by repo root
 * path so each project has its own list. Pure UI preference — never read
 * by the backend.
 */

import { create } from "zustand";

const STORAGE_KEY = "argus:git-favorites";

interface FavoritesState {
  /** repoRoot → list of favorite local branch names. */
  byRepo: Record<string, string[]>;
}

function load(): FavoritesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { byRepo: {} };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "byRepo" in parsed) {
      const byRepo = (parsed as { byRepo: unknown }).byRepo;
      if (byRepo && typeof byRepo === "object") {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(
          byRepo as Record<string, unknown>,
        )) {
          if (Array.isArray(v)) {
            out[k] = v.filter((x): x is string => typeof x === "string");
          }
        }

        return { byRepo: out };
      }
    }
  } catch {
    // ignore — fall through to default
  }

  return { byRepo: {} };
}

function persist(state: FavoritesState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private mode); silently drop.
  }
}

const store = create<FavoritesState>(() => load());

const EMPTY: string[] = [];

export const useBranchFavorites = (repoRoot: string): string[] =>
  store((s) => s.byRepo[repoRoot] ?? EMPTY);

export const isBranchFavorite = (repoRoot: string, branch: string): boolean =>
  (store.getState().byRepo[repoRoot] ?? []).includes(branch);

export const toggleBranchFavorite = (
  repoRoot: string,
  branch: string,
): void => {
  const state = store.getState();
  const current = state.byRepo[repoRoot] ?? [];
  const next = current.includes(branch)
    ? current.filter((b) => b !== branch)
    : [...current, branch];
  const nextState: FavoritesState = {
    byRepo: { ...state.byRepo, [repoRoot]: next },
  };
  store.setState(nextState);
  persist(nextState);
};
