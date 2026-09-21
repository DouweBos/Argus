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

export async function runSetupChecks(force = false): Promise<void> {
  const { ran, running } = setupChecksStore.getState();
  if (running || (ran && !force)) {
    return;
  }
  setupChecksStore.setState({ running: true });
  try {
    const results = await checkPrereqs(SETUP_PREREQS);
    setupChecksStore.setState({
      results: Object.fromEntries(results.map((r) => [r.id, r])),
      ran: true,
    });
  } finally {
    setupChecksStore.setState({ running: false });
  }
}

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
