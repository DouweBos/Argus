import type { PrereqId, PrereqResult } from "../lib/types";
import { create } from "zustand";
import { checkPrereqs } from "../lib/ipc";

/**
 * Environment checks surfaced as cards on the home screen instead of an
 * onboarding wizard. `claude_auth` shells out to the CLI, so checks run once
 * per launch and afterwards only on an explicit re-check.
 */
export const SETUP_PREREQS: PrereqId[] = [
  "claude_cli",
  "claude_auth",
  "git_cli",
  "git_identity",
];

const DISMISSED_KEY = "argus:setup-cards-dismissed";

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

interface SetupChecksState {
  /** Card ids the user hid — optional cards only. */
  dismissed: string[];
  ran: boolean;
  results: Partial<Record<PrereqId, PrereqResult>>;
  running: boolean;
}

export const setupChecksStore = create<SetupChecksState>(() => ({
  dismissed: loadDismissed(),
  ran: false,
  results: {},
  running: false,
}));

export const useSetupChecks = setupChecksStore;

export async function runSetupChecks(
  force = false,
  ids: PrereqId[] = SETUP_PREREQS,
): Promise<void> {
  const { running, results } = setupChecksStore.getState();
  if (running || (setupChecksStore.getState().ran && !force)) {
    return;
  }
  setupChecksStore.setState({ running: true });
  try {
    // A targeted run must not leave a never-checked id with no verdict, or that
    // banner stays hidden until the app reloads — fill the holes in.
    const missing = SETUP_PREREQS.filter((id) => !results[id]);
    const found = await checkPrereqs([...new Set([...ids, ...missing])]);
    setupChecksStore.setState((s) => ({
      results: {
        ...s.results,
        ...Object.fromEntries(found.map((r) => [r.id, r])),
      },
      ran: true,
    }));
  } finally {
    setupChecksStore.setState({ running: false });
  }
}

/**
 * Re-run only the auth check. Unlike the others it depends on state that moves
 * during a session — signing in, switching or exhausting an account — so the
 * home banner re-checks when the account list says it changed.
 */
export const runAuthCheck = (): Promise<void> =>
  runSetupChecks(true, ["claude_auth"]);

export function dismissSetupCard(id: string): void {
  setupChecksStore.setState((s) => {
    const dismissed = s.dismissed.includes(id)
      ? s.dismissed
      : [...s.dismissed, id];
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
    } catch {
      // Storage is best-effort — a failed write just means the card returns.
    }

    return { dismissed };
  });
}
