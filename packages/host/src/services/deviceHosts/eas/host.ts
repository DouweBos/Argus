/**
 * One EAS Simulator host at runtime. A device exists only while a session
 * runs, and every session bills the Expo account until it stops, so this host
 * bounds each one (run and idle limits), refuses to start past its session
 * limit, stops its sessions when it is removed or the host process exits, and
 * stops sessions a previous process left behind. It never touches sessions
 * it did not start: everything it stops is found by the unique name it
 * recorded before creating it.
 *
 * Devices are slots, `eas:<hostId>:<n>`: a slot is booted while its session
 * runs, so callers open, capture and close it like any simulator.
 */

import type { EasHostConfig } from "./config";
import type { LedgerEntry } from "./ledger";
import type { SimulatorDevice } from "../../simulator/deviceSource";
import { randomBytes } from "node:crypto";
import { createLogger } from "@argus/host/logger";
import { capture } from "../../telemetry/telemetry";
import {
  EasError,
  type ExpoCredential,
  resolveExpoCredential,
} from "./credential";
import { type ExpoApi, makeExpoApi } from "./expoApi";
import {
  type EasEndReason,
  type ServeSimEndpoint,
  durationBucket,
  easDeviceId,
  waitBucket,
} from "./ids";
import { previewDevice } from "./serveSim";
import { EasSessionBook } from "./sessionBook";
import { awaitRunning, resolveAppId } from "./start";

const log = createLogger("eas");

/** How often a starting session's status is read. */
const POLL_MS = 5_000;
/** Expo's own CLI waits this long once a worker picks the session up. */
const START_TIMEOUT_MS = 15 * 60_000;
/** How stale a running session's status may get before listing rechecks it. */
const STATUS_TTL_MS = 15_000;
/** How often listing looks for recorded sessions nothing tracks. */
const REAP_INTERVAL_MS = 60_000;

interface Slot {
  slot: number;
  name: string;
  status: "running" | "starting" | "stopping";
  sessionId: string | null;
  preview: { origin: string; token: string } | null;
  udid: string | null;
  startedAt: number;
  readyAt: number | null;
  checkedAt: number;
  cancelled: boolean;
  wake: (() => void) | null;
  start: Promise<void> | null;
}

export interface EasHostDeps {
  /** The token saved for this host, or "". */
  savedToken: () => string;
  now?: () => number;
  pollMs?: number;
  startTimeoutMs?: number;
  /** Resolve a credential; tests pass a fixed one. */
  credential?: (saved: string) => ExpoCredential;
}

export class EasHost {
  private readonly slots = new Map<number, Slot>();
  private readonly book: EasSessionBook;
  /** Bumped by stopAll, so a start that finishes afterwards stops its own session. */
  private epoch = 0;
  private closed = false;
  private maintaining: Promise<void> | null = null;
  error: string | null = null;

  constructor(
    public config: EasHostConfig,
    private readonly deps: EasHostDeps,
  ) {
    this.book = new EasSessionBook(config.id, () => this.now());
  }

  get id(): string {
    return this.config.id;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The API with the current credential; throws how to sign in. */
  api(): ExpoApi {
    const saved = this.deps.savedToken();
    const credential = (this.deps.credential ?? resolveExpoCredential)(saved);

    return makeExpoApi(credential);
  }

  /** Running and starting sessions, plus what still counts against the limit. */
  activeCount(): number {
    return this.slots.size + this.book.pending();
  }

  runningSessions(): number {
    return this.slots.size;
  }

  /** Running and starting slots, then the next free one while under the limit. */
  listDevices(): SimulatorDevice[] {
    const device = (slot: number, s?: Slot): SimulatorDevice => ({
      udid: easDeviceId(this.id, slot),
      name: `iPhone (EAS ${String(slot)})`,
      runtime:
        s && s.status !== "running"
          ? `EAS Simulator · ${s.status}`
          : "EAS Simulator",
      booted: s?.status === "running",
      deviceHostId: this.id,
      deviceHostLabel: this.config.label,
    });
    const out = [...this.slots.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((s) => device(s.slot, s));
    const free = this.nextSlot();
    if (free !== null) {
      out.push(device(free));
    }

    return out;
  }

  /** The slot a new session would take, or null at the limit. */
  nextSlot(): number | null {
    if (this.activeCount() >= this.config.maxConcurrentSessions) {
      return null;
    }
    for (let n = 1; n <= 20; n++) {
      if (!this.slots.has(n)) {
        return n;
      }
    }

    return null;
  }

  isRunning(slot: number): boolean {
    return this.slots.get(slot)?.status === "running";
  }

  /** serve-sim for a running slot. The token never leaves the host. */
  endpoint(slot: number): ServeSimEndpoint | null {
    const s = this.slots.get(slot);
    if (s?.status !== "running" || !s.preview || !s.udid) {
      return null;
    }

    return { origin: s.preview.origin, token: s.preview.token, udid: s.udid };
  }

  private limitMessage(): string {
    const max = this.config.maxConcurrentSessions;
    const limit = `${this.config.label} is limited to ${String(max)} running ${max === 1 ? "session" : "sessions"}.`;
    const pending = this.book.pending();

    return pending > 0
      ? `${limit} ${pending === 1 ? "A session" : `${String(pending)} sessions`} that failed to start or stop ${pending === 1 ? "is" : "are"} still being cleaned up; try again shortly.`
      : `${limit} Close one first, or raise the limit in Settings → Tools → Device hosts.`;
  }

  /** Start a billed session in `slot` and wait until it streams. Running already is fine. */
  open(slot: number): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new EasError("cancelled", `${this.config.label} was removed.`),
      );
    }
    const existing = this.slots.get(slot);
    if (existing?.status === "running") {
      return Promise.resolve();
    }
    if (existing?.status === "starting" && existing.start) {
      return existing.start;
    }
    if (existing?.status === "stopping") {
      return Promise.reject(
        new EasError(
          "limit",
          "That session is still stopping; try again shortly.",
        ),
      );
    }
    let api: ExpoApi;
    try {
      // Without a credential the answer is how to sign in, not that the limit is reached.
      api = this.api();
    } catch (e) {
      this.failStart(e);

      return Promise.reject(e as Error);
    }
    if (this.activeCount() >= this.config.maxConcurrentSessions) {
      const e = new EasError("limit", this.limitMessage());
      this.failStart(e);

      return Promise.reject(e);
    }
    const entry: Slot = {
      slot,
      name: `Argus · ${this.config.label} · ${randomBytes(3).toString("hex")}`,
      status: "starting",
      sessionId: null,
      preview: null,
      udid: null,
      startedAt: this.now(),
      readyAt: null,
      checkedAt: 0,
      cancelled: false,
      wake: null,
      start: null,
    };
    this.slots.set(slot, entry);
    const startedIn = this.epoch;
    entry.start = this.startSession(api, entry, startedIn).catch(
      (e: unknown) => {
        if (this.slots.get(slot) === entry) {
          this.slots.delete(slot);
        }
        this.failStart(e);
        throw e;
      },
    );

    return entry.start;
  }

  private failStart(e: unknown): void {
    const failure = e instanceof EasError ? e.failure : "api";
    this.error = e instanceof Error ? e.message : String(e);
    capture("eas_session_start_failed", { reason: failure });
  }

  private cancelledError(): EasError {
    return new EasError(
      "cancelled",
      `${this.config.label} was stopped while the session started.`,
    );
  }

  private async startSession(
    api: ExpoApi,
    entry: Slot,
    startedIn: number,
  ): Promise<void> {
    const isCancelled = () =>
      entry.cancelled || this.epoch !== startedIn || this.closed;
    const appId = await resolveAppId(api, this.config);
    const access = await api.availability(appId);
    if (!access.available) {
      throw new EasError(
        "not_enabled",
        `EAS Simulator is not enabled for the ${access.account} Expo account.`,
      );
    }
    const record: LedgerEntry = {
      name: entry.name,
      appId,
      recordedAt: this.now(),
    };
    // Recorded first: a session the ledger cannot hold is never started.
    this.book.record(record);
    if (isCancelled()) {
      this.book.forget(entry.name);
      throw this.cancelledError();
    }
    let sessionId: string;
    try {
      sessionId = await api.create({
        appId,
        name: entry.name,
        maxRunTimeMinutes: this.config.maxSessionMinutes,
        maxIdleTimeMinutes: this.config.idleMinutes,
      });
    } catch (e) {
      // Unless Expo refused, it may have made the session before failing to
      // answer: look for it by name, and count it until it would be listed.
      const { found } = await this.book
        .stopRecorded(api, [record])
        .catch(() => ({
          found: new Set<string>(),
        }));
      if (!found.has(entry.name)) {
        if (e instanceof EasError && e.rejected) {
          this.book.markRefused(entry.name);
        } else {
          this.book.markUncertain(record);
        }
      }
      throw e;
    }
    entry.sessionId = sessionId;
    try {
      const preview = await awaitRunning(api, entry.sessionId, {
        isCancelled,
        cancelled: () => this.cancelledError(),
        deadline: this.now() + (this.deps.startTimeoutMs ?? START_TIMEOUT_MS),
        now: () => this.now(),
        pollMs: this.deps.pollMs ?? POLL_MS,
        onWait: (wake) => {
          entry.wake = wake;
        },
      });
      const origin = new URL(preview.url).origin;
      const udid = await previewDevice(origin, preview.token);
      if (isCancelled()) {
        throw this.cancelledError();
      }
      entry.preview = { origin, token: preview.token };
      entry.udid = udid;
      entry.status = "running";
      entry.readyAt = this.now();
      entry.checkedAt = this.now();
      this.error = null;
      capture("eas_session_started", {
        wait_bucket: waitBucket(entry.readyAt - entry.startedAt),
      });
      log.info(`session ready in slot ${String(entry.slot)} of ${this.id}`);
    } catch (e) {
      await this.book.stop(api, sessionId, entry.name).catch(() => {
        // Still running and billed: owned, counted, and retried by listing.
        this.book.unresolved.set(entry.name, sessionId);
      });
      throw e;
    }
  }

  /** Stop a slot's session. Until Expo confirms, it stays listed and counted. */
  async close(slot: number, reason: EasEndReason = "closed"): Promise<void> {
    const entry = this.slots.get(slot);
    if (!entry) {
      return;
    }
    if (entry.status === "starting") {
      entry.cancelled = true;
      entry.wake?.();
      await entry.start?.catch(() => {});

      return;
    }
    entry.status = "stopping";
    const api = this.api();
    await this.book.stop(api, entry.sessionId ?? "", entry.name);
    this.endSlot(entry, reason);
  }

  private endSlot(entry: Slot, reason: EasEndReason): void {
    if (this.slots.get(entry.slot) === entry) {
      this.slots.delete(entry.slot);
    }
    capture("eas_session_ended", {
      reason,
      duration_bucket: durationBucket(
        entry.readyAt === null ? null : this.now() - entry.readyAt,
      ),
    });
  }

  private ownedNames(): Set<string> {
    return new Set([...this.slots.values()].map((s) => s.name));
  }

  /** Records a previous process left count against the limit until a sweep finds them. */
  adoptRecorded(): void {
    try {
      this.book.adopt(this.ownedNames());
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Stop recorded sessions this host does not own. */
  reapLeftovers(api: ExpoApi): Promise<void> {
    return this.book.reap(api, this.ownedNames());
  }

  /** Listing's housekeeping: drop sessions Expo ended, retry failed stops, reap now and then. */
  maintain(): Promise<void> {
    this.maintaining ??= this.runMaintenance().finally(() => {
      this.maintaining = null;
    });

    return this.maintaining;
  }

  private async runMaintenance(): Promise<void> {
    if (this.closed) {
      return;
    }
    const now = this.now();
    const stale = [...this.slots.values()].filter(
      (s) =>
        s.status === "stopping" ||
        (s.status === "running" && now - s.checkedAt > STATUS_TTL_MS),
    );
    const reapDue = now - this.book.reapedAt > REAP_INTERVAL_MS;
    if (stale.length === 0 && this.book.pending() === 0 && !reapDue) {
      return;
    }
    let api: ExpoApi;
    try {
      api = this.api();
    } catch {
      this.book.expireUncertain();

      return;
    }
    await this.book.retryUnresolved(api);
    for (const entry of stale) {
      await this.recheck(api, entry, now);
    }
    if (reapDue || this.book.uncertain.size > 0) {
      await this.reapLeftovers(api).catch((e: unknown) =>
        log.warn("could not stop recorded EAS sessions", e),
      );
    }
  }

  private async recheck(api: ExpoApi, entry: Slot, now: number): Promise<void> {
    if (entry.status === "stopping") {
      try {
        await this.book.stop(api, entry.sessionId ?? "", entry.name);
        this.endSlot(entry, "closed");

        return;
      } catch {
        // Falls through to the status check.
      }
    }
    const current = await api.session(entry.sessionId ?? "").catch(() => null);
    if (current?.status === "STOPPED" || current?.status === "ERRORED") {
      this.book.forget(entry.name);
      this.endSlot(entry, entry.status === "stopping" ? "closed" : "expired");
    } else if (current) {
      entry.checkedAt = now;
    }
  }

  /**
   * Stop everything this host started: cancel starts, stop running sessions,
   * retry failed stops, and sweep recorded leftovers. A stop that fails stays
   * in the ledger for the next host process.
   */
  async stopAll(reason: EasEndReason): Promise<void> {
    this.epoch++;
    const starting = [...this.slots.values()].filter(
      (s) => s.status === "starting",
    );
    for (const s of starting) {
      s.cancelled = true;
      s.wake?.();
    }
    await Promise.all(starting.map((s) => s.start?.catch(() => {})));
    let api: ExpoApi;
    try {
      api = this.api();
    } catch {
      return;
    }
    await Promise.all(
      [...this.slots.values()].map((s) =>
        this.close(s.slot, reason).catch((e: unknown) =>
          log.warn(`could not stop slot ${String(s.slot)} of ${this.id}`, e),
        ),
      ),
    );
    await this.book.retryUnresolved(api);
    await this.reapLeftovers(api).catch((e: unknown) =>
      log.warn("could not stop recorded EAS sessions", e),
    );
  }

  /** Whether anything this host started may still be billed. */
  hasOutstanding(): boolean {
    return this.slots.size > 0 || this.book.hasOutstanding();
  }

  /** After removal: no more ledger writes or starts from this instance. */
  retire(): void {
    this.closed = true;
    this.book.close();
  }
}
