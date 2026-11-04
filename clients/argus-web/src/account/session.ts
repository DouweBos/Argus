/**
 * This browser as a device on an Argus account: sign-in bootstrap, the
 * verified log, the directory, its name and signing out. The join flow lives
 * in `join.ts`. Framework-free; `accountStore.ts` wraps it for React.
 *
 * Mirrors the Apple clients' `AccountStore`, minus what a browser shouldn't
 * do: it never writes genesis (a browser is never the account's root of
 * trust) and never approves other devices.
 */

import type {
  AccountMember,
  LogEntry,
  LogState,
} from "@argus/remote-protocol/account";
import {
  accountApprovals,
  makeEntryWith,
  normalizeMemberName,
  safetyCode,
  sha256Hex,
  verifyLog,
} from "@argus/remote-protocol/account";
import type { HostCredentials } from "@argus/remote-client";
import {
  type AccountClient,
  type AccountInfo,
  describeAccountError,
  UNTRUSTED_LOG,
} from "./client";
import {
  type AccountComputer,
  accountComputers,
  mergePresence,
} from "./directory";
import {
  type JoinFlow,
  continueJoin,
  offerApprovedJoin,
  stopJoin,
  type PendingJoinState,
  type ApprovedJoin,
  admitsConfirmedJoin,
} from "./join";
import { type AccountVault, EMPTY_VAULT, type VaultStore } from "./vault";
import { entrySigner, noiseStaticKey, type WebDeviceKeys } from "./webKeys";

export type AccountPhase =
  | "loading"
  /** No Ed25519/X25519 in this browser's WebCrypto, or no IndexedDB. */
  | "unsupported"
  /** The account service or the sign-in provider couldn't be reached. */
  | "unavailable"
  | "signedOut"
  | "settingUp"
  /** Signed in, but the account has no devices yet; a browser can't be its first. */
  | "empty"
  | "awaitingApproval"
  | "ready";

export interface AccountAuth {
  isSignedIn: () => boolean;
  token: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Ask the user to verify their sign-in again; false when they cancel. */
  reverify: () => Promise<boolean>;
}

export interface AccountSessionDeps {
  client: AccountClient;
  vaults: VaultStore;
  auth: AccountAuth;
  /** This browser's name until the user picks one. */
  defaultName: () => string;
  generateKeys: (name: string, now: number) => Promise<WebDeviceKeys>;
  now?: () => number;
  /** How often an open join request is polled; 0 = only when asked (tests). */
  joinPollMs?: number;
  onChange?: () => void;
}

export class AccountSession {
  phase: AccountPhase = "loading";
  join: JoinFlow = { kind: "idle" };
  state: LogState | null = null;
  vault: AccountVault = EMPTY_VAULT;
  error: string | null = null;
  /** Why the last log fetch was refused, if it was. */
  logError: string | null = null;
  computers: AccountComputer[] = [];
  pendingJoin: PendingJoinState | null = null;
  approvedJoin: ApprovedJoin | null = null;
  joinTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly deps: AccountSessionDeps) {}

  get client(): AccountClient {
    return this.deps.client;
  }

  now(): number {
    return (this.deps.now ?? Date.now)();
  }

  changed(): void {
    this.deps.onChange?.();
  }

  async save(): Promise<void> {
    await this.deps.vaults.save(this.vault);
  }

  get keys(): WebDeviceKeys | null {
    return this.vault.keys;
  }

  /** The name this browser goes by on the account. */
  get name(): string {
    return this.vault.keys?.name ?? this.deps.defaultName();
  }

  get safetyCode(): string | null {
    return this.state ? safetyCode(this.state.genesis_hash) : null;
  }

  /** Live devices and hosts, this browser first. */
  get members(): AccountMember[] {
    const own = this.vault.keys?.memberId;

    return Object.values(this.state?.members ?? {})
      .filter((m) => m.live)
      .map((m) => m.member)
      .sort((a, b) => Number(b.id === own) - Number(a.id === own) || a.created_at - b.created_at);
  }

  ownMemberLive(state: LogState): boolean {
    const keys = this.vault.keys;
    const found = keys ? state.members[keys.memberId] : undefined;

    return !!found?.live && found.member.sign_pub === keys?.signPub;
  }

  /** The code `memberId` was approved with, so it can be checked by eye. */
  approvalCode(memberId: string): string | null {
    return accountApprovals(this.vault.entries)[memberId]?.sas.sas ?? null;
  }

  // --- Lifecycle -----------------------------------------------------------

  /** Read back what this browser already trusts, then reach the service. */
  async start(): Promise<void> {
    this.vault = await this.deps.vaults.load();
    const { root, entries } = this.vault;
    if (root && entries.length > 0) {
      const verified = verifyLog(entries, { root });
      if (verified.ok && this.ownMemberLive(verified.state)) {
        this.state = verified.state;
        this.publishComputers();
      }
    }
    this.phase = "signedOut";
    this.changed();
    if (this.deps.auth.isSignedIn()) {
      await this.bootstrap();
    }
  }

  /**
   * Signed in with Clerk: resume when this browser is already on the
   * account, and otherwise ask to join.
   */
  async bootstrap(): Promise<void> {
    this.phase = "settingUp";
    this.error = null;
    this.changed();
    let info: AccountInfo;
    try {
      info = await this.client.account();
    } catch (err) {
      this.fail(err, "signedOut");

      return;
    }
    const root = this.vault.root;
    if (root && (root.account_id !== info.account_id || root.epoch !== info.epoch)) {
      // Another account, or a reset one: start over with the same keys.
      this.vault = { ...EMPTY_VAULT, keys: this.vault.keys };
      this.state = null;
      await this.save();
    }
    if (info.head_seq === null) {
      this.phase = "empty";
      this.changed();

      return;
    }
    let entries: LogEntry[];
    try {
      entries = await this.client.log(info.epoch, -1);
    } catch (err) {
      this.fail(err, "signedOut");

      return;
    }
    const verified = verifyLog(entries, { root: this.vault.root });
    if (!verified.ok) {
      this.logError = verified.reason;
      this.fail(new Error(UNTRUSTED_LOG), "signedOut");

      return;
    }
    if (!this.ownMemberLive(verified.state)) {
      this.phase = "awaitingApproval";
      this.changed();
      await continueJoin(this, info);

      return;
    }
    if (!this.vault.root && !admitsConfirmedJoin(this, verified.state)) {
      this.phase = "awaitingApproval";
      this.changed();
      await offerApprovedJoin(this, verified.state, entries);

      return;
    }
    await this.adopt(verified.state, entries);
  }

  /** Pin and keep a log that has this browser on it. */
  async adopt(state: LogState, entries: LogEntry[]): Promise<void> {
    stopJoin(this);
    this.approvedJoin = null;
    this.vault = {
      ...this.vault,
      root: {
        account_id: state.account_id,
        epoch: state.epoch,
        genesis_hash: state.genesis_hash,
      },
      entries,
      pendingJoin: null,
      joinRequestId: null,
      joinCommit: null,
    };
    this.state = state;
    this.logError = null;
    this.join = { kind: "idle" };
    this.phase = "ready";
    await this.save();
    this.publishComputers();
    this.changed();
    await this.flushName();
    await this.refreshDirectory();
  }

  /** Back in view: new entries, renames waiting to go out, moved addresses. */
  async refresh(): Promise<void> {
    if (this.phase !== "ready") {
      return;
    }
    await this.refreshLog();
    await this.flushName();
    await this.refreshDirectory();
  }

  fail(err: unknown, phase: AccountPhase): void {
    this.error = describeAccountError(err);
    this.phase = phase;
    this.changed();
  }

  // --- Log -----------------------------------------------------------------

  async refreshLog(): Promise<void> {
    const current = this.state;
    const root = this.vault.root;
    if (!current || !root) {
      return;
    }
    let fresh: LogEntry[];
    try {
      fresh = await this.client.log(current.epoch, current.head.seq);
    } catch {
      return;
    }
    if (fresh.length === 0) {
      return;
    }
    const verified = verifyLog(fresh, { root, prior: current });
    if (!verified.ok) {
      this.logError = verified.reason;
      this.changed();

      return;
    }
    this.logError = null;
    await this.applyVerified(verified.state, fresh);
  }

  private async applyVerified(next: LogState, appended: LogEntry[]): Promise<void> {
    const prior = this.state;
    this.state = next;
    this.vault = { ...this.vault, entries: [...this.vault.entries, ...appended] };
    if (!this.ownMemberLive(next)) {
      await this.forget();
      this.error = "This browser was removed from your account.";
      this.changed();

      return;
    }
    if (prior) {
      this.reflectName(prior, next);
    }
    await this.save();
    this.publishComputers();
    this.changed();
  }

  /**
   * Sign entries against the current head and append them; when another
   * device moved the head first, catch up and sign again, once.
   */
  async appendWithRetry(
    build: (head: { seq: number; hash: string }) => Promise<LogEntry[]>,
    apply = true,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = this.state;
      if (!current) {
        throw new Error("Sign in first.");
      }
      const entries = await build(current.head);
      try {
        await this.client.append(current.epoch, entries);
      } catch (err) {
        if (attempt === 0 && (err as { isConflict?: boolean }).isConflict) {
          await this.refreshLog();
          continue;
        }
        throw err;
      }
      if (apply) {
        const verified = verifyLog(entries, { root: this.vault.root, prior: current });
        if (!verified.ok) {
          throw new Error(UNTRUSTED_LOG);
        }
        await this.applyVerified(verified.state, entries);
      }

      return;
    }
    throw new Error("Your account changed while this was open. Try again.");
  }

  entry(
    head: { seq: number; hash: string },
    fields: Record<string, unknown> & { type: string },
  ): Promise<LogEntry> {
    const current = this.state;
    const keys = this.vault.keys;
    if (!current || !keys) {
      throw new Error("Sign in first.");
    }

    return makeEntryWith(
      { account_id: current.account_id, epoch: current.epoch, head, ts: this.now() },
      entrySigner(keys),
      fields,
    );
  }

  // --- Directory -----------------------------------------------------------

  /** Verified presence for every live host. Online is recomputed even when the fetch fails. */
  async refreshDirectory(): Promise<void> {
    const current = this.state;
    if (this.phase !== "ready" || !current) {
      return;
    }
    try {
      const records = await this.client.directory();
      const presence = mergePresence(current, this.vault.presence, records);
      if (JSON.stringify(presence) !== JSON.stringify(this.vault.presence)) {
        this.vault = { ...this.vault, presence };
        await this.save();
      }
    } catch {
      // Keep the last good addresses.
    }
    this.publishComputers();
    this.changed();
  }

  publishComputers(): void {
    this.computers = this.state
      ? accountComputers(this.state, this.vault.presence, this.now())
      : [];
  }

  /** How to dial `computer`: its best `wss://` route, the log's key, this browser's Noise key. */
  credentialsFor(computer: AccountComputer): HostCredentials | null {
    const keys = this.vault.keys;
    const route = computer.routes[0];
    if (!keys || !route) {
      return null;
    }

    return {
      url: route.url,
      devPrivB64: "",
      devPubB64: keys.noisePub,
      hostPubB64: computer.noisePub,
      staticKey: noiseStaticKey(keys),
    };
  }

  async rememberHost(hostId: string | null): Promise<void> {
    this.vault = { ...this.vault, lastHostId: hostId };
    await this.save();
  }

  /**
   * Entries a host hasn't seen yet, for `account.sync` right after a
   * handshake, so a removal reaches it even when the service holds it back.
   * Null when the host is on another account or already caught up.
   */
  syncPayload(status: {
    linked: boolean;
    account_id_hash: string | null;
    head_seq: number | null;
  }): { epoch: number; entries: LogEntry[] } | null {
    const current = this.state;
    if (
      !current ||
      !status.linked ||
      status.account_id_hash !== sha256Hex(current.account_id) ||
      status.head_seq === null ||
      status.head_seq >= current.head.seq
    ) {
      return null;
    }

    return {
      epoch: current.epoch,
      entries: this.vault.entries.slice(status.head_seq + 1, status.head_seq + 501),
    };
  }

  // --- Name ----------------------------------------------------------------

  /** The name setting: renames this browser on the account now, or once it's reachable. */
  async setName(raw: string): Promise<boolean> {
    const name = normalizeMemberName(raw);
    const keys = this.vault.keys;
    if (!name || !keys) {
      this.error = "Names are 1–64 characters on one line.";
      this.changed();

      return false;
    }
    this.error = null;
    this.vault = { ...this.vault, keys: { ...keys, name }, pendingName: name };
    await this.save();
    this.changed();
    await this.flushName();

    return true;
  }

  async flushName(): Promise<void> {
    while (this.phase === "ready" && this.vault.pendingName) {
      const name = this.vault.pendingName;
      const id = this.vault.keys?.memberId;
      const member = id ? this.state?.members[id] : undefined;
      if (member?.live && member.member.name !== name) {
        try {
          await this.appendWithRetry(async (head) => [
            await this.entry(head, { type: "rename", member_id: member.member.id, name }),
          ]);
        } catch {
          return;
        }
      }
      if (this.vault.pendingName === name) {
        this.vault = { ...this.vault, pendingName: null };
        await this.save();
      }
    }
  }

  /** Another device renamed this browser: the setting follows, unless a local edit is pending. */
  private reflectName(prior: LogState, next: LogState): void {
    const keys = this.vault.keys;
    if (!keys || this.vault.pendingName) {
      return;
    }
    const after = next.members[keys.memberId]?.member.name;
    if (after && after !== prior.members[keys.memberId]?.member.name && after !== keys.name) {
      this.vault = { ...this.vault, keys: { ...keys, name: after } };
    }
  }

  // --- Sign out ------------------------------------------------------------

  /** Take this browser off the account, forget its keys, end the Clerk session. */
  async signOut(): Promise<void> {
    const open = this.pendingJoin?.requestId ?? this.vault.pendingJoin?.requestId;
    if (open) {
      await this.client.deny(open).catch(() => undefined);
    }
    const id = this.vault.keys?.memberId;
    if (this.phase === "ready" && id) {
      // Not applied: the vault is wiped right after.
      await this.appendWithRetry(
        async (head) => [
          await this.entry(head, { type: "revoke", member_id: id, reason: "unlinked" }),
        ],
        false,
      ).catch(() => undefined);
    }
    await this.deps.auth.signOut().catch(() => undefined);
    await this.forget();
    this.changed();
  }

  async forget(): Promise<void> {
    stopJoin(this);
    this.approvedJoin = null;
    this.vault = EMPTY_VAULT;
    this.state = null;
    this.computers = [];
    this.join = { kind: "idle" };
    this.phase = "signedOut";
    await this.save();
  }
}
