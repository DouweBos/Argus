/**
 * The computer's Claude accounts: which are signed in, which one new agents
 * run as, and a sign-in followed from here. Mirrors `HostStore+ClaudeAccounts`.
 *
 * The sign-in opens a browser on the computer, so this client follows the
 * attempt through `claude_accounts.login` and can finish it by pasting the
 * code Claude shows.
 */

import { create } from "zustand";
import { describeError, INITIAL_LOAD, type LoadState } from "@argus/client-core";
import type {
  RemoteClaudeAccount,
  RemoteClaudeLoginState,
} from "@argus/remote-protocol";
import { request } from "../lib/request";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import { useProjectsStore } from "./projects";

interface ClaudeAccountsState {
  accounts: RemoteClaudeAccount[] | null;
  activeId: string | null;
  load: LoadState;
  /** What the computer last said about a sign-in; null when none was seen. */
  login: RemoteClaudeLoginState | null;
  /** The sign-in page the computer opened, to read or copy from here. */
  loginUrl: string | null;
  /** The last action's failure, shown on the accounts screen. */
  error: string | null;
  busy: boolean;

  refresh: (options?: { background?: boolean }) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  rename: (id: string, label: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** A new account (no id) or signing `accountId` in again. */
  startSignIn: (options: {
    accountId?: string;
    useConsole: boolean;
  }) => Promise<void>;
  cancelSignIn: () => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  loadLoginStatus: () => Promise<void>;
  /** Pin the agent's session to an account, or null to follow the active one. */
  setAgentAccount: (
    agentId: string,
    sessionId: string,
    accountId: string | null,
  ) => Promise<void>;
}

const EMPTY = {
  accounts: null,
  activeId: null,
  load: INITIAL_LOAD,
  login: null,
  loginUrl: null,
  error: null,
  busy: false,
} satisfies Partial<ClaudeAccountsState>;

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

export const useClaudeAccountsStore = create<ClaudeAccountsState>()(
  (set, get) => {
    /** A mutation: its failure is the screen's error, and the list always re-reads. */
    async function run(action: () => Promise<unknown>): Promise<void> {
      set({ busy: true, error: null });
      try {
        await action();
      } catch (err) {
        set({ error: describeError(err) });
      } finally {
        set({ busy: false });
        await get().refresh({ background: true });
      }
    }

    return {
      ...EMPTY,

      refresh: async ({ background = false } = {}) => {
        const transport = currentTransport();
        if (!transport) {
          return;
        }
        try {
          const result = await request(
            transport,
            "claude_accounts.list",
            {},
            { background },
          );
          set({
            accounts: result.accounts,
            activeId: result.active_id,
            load: { loaded: true, error: null },
          });
        } catch (err) {
          set((s) => ({
            load: { loaded: true, error: describeError(err) },
            accounts: s.accounts ?? (background ? null : []),
          }));
        }
      },

      setActive: (id) => {
        capture("web_claude_account_changed", { action: "select" });

        return run(async () => {
          await request(connected(), "claude_accounts.set_active", { id });
          set({ activeId: id });
        });
      },

      rename: (id, label) => {
        const trimmed = label.trim();
        if (!trimmed) {
          return Promise.resolve();
        }
        capture("web_claude_account_changed", { action: "rename" });
        // Keep the typed name even if the echo arrives after they move on.
        set((s) => ({
          accounts:
            s.accounts?.map((a) => (a.id === id ? { ...a, label: trimmed } : a)) ??
            null,
        }));

        return run(() =>
          request(connected(), "claude_accounts.rename", { id, label: trimmed }),
        );
      },

      remove: (id) => {
        capture("web_claude_account_changed", { action: "remove" });

        return run(async () => {
          await request(connected(), "claude_accounts.remove", { id });
          set((s) => ({
            accounts: s.accounts?.filter((a) => a.id !== id) ?? null,
          }));
        });
      },

      startSignIn: async ({ accountId, useConsole }) => {
        capture("web_claude_account_changed", {
          action: accountId ? "reauth" : "add",
        });
        set({ error: null, login: null, loginUrl: null });
        try {
          const { url } = accountId
            ? await request(connected(), "claude_accounts.login_start", {
                account_id: accountId,
                use_console: useConsole,
              })
            : await request(connected(), "claude_accounts.add", {
                use_console: useConsole,
              });
          set({ login: { pending: true, needs_code: false }, loginUrl: url });
        } catch (err) {
          set({ login: null, error: describeError(err) });
        }
        await get().refresh({ background: true });
      },

      cancelSignIn: async () => {
        await request(connected(), "claude_accounts.login_cancel", {}).catch(
          () => {},
        );
        set({ login: null, loginUrl: null });
        await get().refresh({ background: true });
      },

      submitCode: async (code) => {
        try {
          const result = await request(
            connected(),
            "claude_accounts.login_submit_code",
            { code: code.trim() },
          );
          capture("web_claude_sign_in_code_submitted", { success: result.ok });
          // A wrong code ends the attempt rather than leaving it waiting.
          set({
            login: {
              pending: false,
              needs_code: false,
              ok: result.ok,
              error: result.ok
                ? undefined
                : (result.error ?? "Sign-in failed. Start again."),
            },
            loginUrl: null,
          });
          if (result.ok) {
            await get().refresh({ background: true });
          }
        } catch (err) {
          capture("web_claude_sign_in_code_submitted", { success: false });
          set({ error: describeError(err) });
        }
      },

      loadLoginStatus: async () => {
        const transport = currentTransport();
        if (!transport) {
          return;
        }
        try {
          const state = await request(
            transport,
            "claude_accounts.login_status",
            {},
          );
          if (state.pending) {
            set({ login: state });
          }
        } catch {
          // An older computer can't say; the push event still covers it.
        }
      },

      setAgentAccount: async (agentId, sessionId, accountId) => {
        await request(connected(), "agents.set_claude_account", {
          agent_id: agentId,
          account_id: accountId,
        });
        // Nothing re-broadcasts the session list on this write.
        useProjectsStore.setState((s) => ({
          sessionsByRepo: Object.fromEntries(
            Object.entries(s.sessionsByRepo).map(([repo, sessions]) => [
              repo,
              sessions.map((session) =>
                session.id === sessionId
                  ? { ...session, claude_account_id: accountId }
                  : session,
              ),
            ]),
          ),
        }));
      },
    };
  },
);

/** `claude_accounts.changed`: the list as it now stands. */
export function receiveClaudeAccounts(payload: {
  accounts: RemoteClaudeAccount[];
  active_id: string;
}): void {
  useClaudeAccountsStore.setState({
    accounts: payload.accounts,
    activeId: payload.active_id,
    load: { loaded: true, error: null },
  });
}

/** `claude_accounts.login`: where the computer's sign-in has got to. */
export function receiveClaudeLogin(state: RemoteClaudeLoginState): void {
  useClaudeAccountsStore.setState((s) => ({
    login: state,
    loginUrl: state.pending ? s.loginUrl : null,
  }));
  if (!state.pending) {
    void useClaudeAccountsStore.getState().refresh({ background: true });
  }
}

export function resetClaudeAccounts(): void {
  useClaudeAccountsStore.setState(EMPTY);
}
