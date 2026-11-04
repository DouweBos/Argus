/**
 * The hosted client's account state for React: wraps {@link AccountSession}
 * and the Clerk instance, and republishes a snapshot on every change.
 */

import type { AccountMember } from "@argus/remote-protocol/account";
import { create } from "zustand";
import { defaultDeviceName } from "../lib/keystore";
import { capture } from "../telemetry/telemetry";
import { accountClient, type AccountClient } from "./client";
import { type ClerkJs, clerkAuth, loadClerk } from "./clerk";
import type { AccountComputer } from "./directory";
import {
  confirmApprovedJoin,
  confirmJoinCode,
  type JoinFlow,
  rejectApprovedJoin,
  rejectJoinCode,
  retryJoin,
} from "./join";
import { deleteAccount, removeMember, renameMember } from "./members";
import { AccountSession, type AccountPhase } from "./session";
import { indexedDbVaultStore } from "./vault";
import { generateDeviceKeys, webCryptoSupported } from "./webKeys";

interface AccountStoreState {
  phase: AccountPhase;
  join: JoinFlow;
  computers: AccountComputer[];
  members: AccountMember[];
  ownId: string | null;
  name: string;
  safetyCode: string | null;
  error: string | null;
  lastHostId: string | null;
  clerk: ClerkJs | null;
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  checkAgain: () => Promise<void>;
  confirmCode: () => Promise<void>;
  rejectCode: () => Promise<void>;
  confirmApproved: () => Promise<void>;
  rejectApproved: () => Promise<void>;
  retryJoin: () => Promise<void>;
  setName: (name: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  renameMember: (id: string, name: string) => Promise<void>;
  /** Removes `id`, then hands the removal to `handOver` (the computers it can reach). */
  removeMember: (
    id: string,
    handOver: (session: AccountSession, computers: AccountComputer[]) => Promise<number>,
  ) => Promise<void>;
  /** False when the user cancelled verifying their sign-in. */
  deleteAccount: () => Promise<boolean>;
  rememberHost: (hostId: string | null) => void;
  approvalCode: (memberId: string) => string | null;
}

let session: AccountSession | null = null;

/** The live session, for wiring a host connection (`hostedConnection.ts`). */
export function accountSession(): AccountSession | null {
  return session;
}

export const useAccountStore = create<AccountStoreState>()((set) => {
  const publish = () => {
    if (!session) {
      return;
    }
    set({
      phase: session.phase,
      join: session.join,
      computers: session.computers,
      members: session.members,
      ownId: session.vault.keys?.memberId ?? null,
      name: session.name,
      safetyCode: session.safetyCode,
      error: session.error,
      lastHostId: session.vault.lastHostId,
    });
  };
  const run = (action: (s: AccountSession) => Promise<void>) => async () => {
    if (session) {
      await action(session);
    }
  };

  return {
    phase: "loading",
    join: { kind: "idle" },
    computers: [],
    members: [],
    ownId: null,
    name: "",
    safetyCode: null,
    error: null,
    lastHostId: null,
    clerk: null,

    boot: async () => {
      if (session) {
        return;
      }
      if (typeof indexedDB === "undefined" || !(await webCryptoSupported())) {
        set({ phase: "unsupported" });

        return;
      }
      let clerk: ClerkJs;
      let client: AccountClient;
      try {
        const bootstrapClient = accountClient(async () => null);
        clerk = await loadClerk(await bootstrapClient.config());
        client = accountClient(
          async (opts) =>
            (await clerk.session?.getToken(opts?.fresh ? { skipCache: true } : undefined)) ?? null,
        );
      } catch {
        set({ phase: "unavailable" });

        return;
      }
      session = new AccountSession({
        client,
        vaults: indexedDbVaultStore(),
        auth: clerkAuth(clerk),
        defaultName: defaultDeviceName,
        generateKeys: (name, now) => generateDeviceKeys(name, now),
        onChange: publish,
      });
      set({ clerk });
      // Signing in through Clerk's form lands here; so does a sign-out elsewhere.
      clerk.addListener(({ user }) => {
        const current = session;
        if (!current) {
          return;
        }
        if (user && current.phase === "signedOut") {
          void current.bootstrap();
        } else if (!user && current.phase !== "signedOut" && current.phase !== "loading") {
          current.phase = "signedOut";
          current.changed();
        }
      });
      await session.start();
    },

    refresh: run((s) => s.refresh()),
    checkAgain: run((s) => s.bootstrap()),
    confirmCode: run(confirmJoinCode),
    rejectCode: run(rejectJoinCode),
    confirmApproved: run(confirmApprovedJoin),
    rejectApproved: run(rejectApprovedJoin),
    retryJoin: run(retryJoin),
    setName: async (name) => (session ? session.setName(name) : false),
    signOut: run(async (s) => {
      await s.signOut();
      capture("web_account_left", { action: "sign_out", outcome: "done", reverified: false });
    }),
    renameMember: async (id, name) => {
      if (!session) {
        return;
      }
      const role = session.state?.members[id]?.member.role ?? "device";
      const self = id === session.vault.keys?.memberId;
      const report = (success: boolean) =>
        capture("web_account_member_changed", {
          action: "rename",
          role,
          self,
          success,
          computers_reached: 0,
        });
      try {
        await renameMember(session, id, name);
      } catch (err) {
        report(false);
        throw err;
      }
      report(true);
    },
    removeMember: async (id, handOver) => {
      const current = session;
      if (!current) {
        return;
      }
      const role = current.state?.members[id]?.member.role ?? "device";
      // Read first: a removed computer still gets told of its own removal.
      const computers = current.computers;
      try {
        await removeMember(current, id);
      } catch (err) {
        capture("web_account_member_changed", {
          action: "remove",
          role,
          self: false,
          success: false,
          computers_reached: 0,
        });
        throw err;
      }
      const reached = await handOver(current, computers).catch(() => 0);
      capture("web_account_member_changed", {
        action: "remove",
        role,
        self: false,
        success: true,
        computers_reached: reached,
      });
    },
    deleteAccount: async () => {
      if (!session) {
        return false;
      }
      try {
        const { outcome, reverified } = await deleteAccount(session);
        capture("web_account_left", {
          action: "delete",
          outcome: outcome === "deleted" ? "done" : "cancelled",
          reverified,
        });

        return outcome === "deleted";
      } catch (err) {
        capture("web_account_left", { action: "delete", outcome: "failed", reverified: false });
        throw err;
      }
    },
    rememberHost: (hostId) => {
      void session?.rememberHost(hostId).then(publish);
    },
    approvalCode: (memberId) => session?.approvalCode(memberId) ?? null,
  };
});
