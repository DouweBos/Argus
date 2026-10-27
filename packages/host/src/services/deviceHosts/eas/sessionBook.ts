/**
 * The bookkeeping behind an EAS host's billing safety: its ledger on disk,
 * sessions whose stop failed (`unresolved`), creates whose outcome is unknown
 * (`uncertain`), and the sweep that finds recorded sessions by name and stops
 * them. Only names in the ledger are ever stopped, so sessions other tools run
 * on the account are never touched.
 */

import type { ExpoApi } from "./expoApi";
import { createLogger } from "@argus/host/logger";
import { capture } from "../../telemetry/telemetry";
import { type LedgerEntry, readLedger, updateLedger } from "./ledger";

const log = createLogger("eas");

/**
 * Expo lists a session it made within seconds; a create with an unknown
 * outcome stops counting against the limit once it has had this long.
 */
export const UNCERTAIN_CREATE_MS = 5 * 60_000;
/** Unlisted records stop counting after this; forgotten once confirmed gone or after a day. */
const RECORD_LIFETIME_MS = 180 * 60_000;
const RECORD_MAX_AGE_MS = 24 * 60 * 60_000;

export class EasSessionBook {
  /** Sessions whose stop failed: still billed, counted, retried by listing. */
  readonly unresolved = new Map<string, string>();
  /** Creates with an unknown outcome, and records a previous process left. */
  readonly uncertain = new Map<string, { entry: LedgerEntry; until: number }>();
  reapedAt = 0;
  private closed = false;

  constructor(
    private readonly hostId: string,
    private readonly now: () => number,
  ) {}

  /** What counts against the limit beyond running and starting slots. */
  pending(): number {
    return this.unresolved.size + this.uncertain.size;
  }

  /** Recorded first: a session the ledger cannot hold is never started. */
  record(entry: LedgerEntry): void {
    updateLedger(this.hostId, (entries) => [...entries, entry]);
  }

  forget(name: string): void {
    if (this.closed) {
      return;
    }
    try {
      updateLedger(this.hostId, (entries) =>
        entries.filter((e) => e.name !== name),
      );
    } catch (e) {
      log.warn("could not update the EAS session record", e);
    }
  }

  markRefused(name: string): void {
    try {
      updateLedger(this.hostId, (entries) =>
        entries.map((e) => (e.name === name ? { ...e, refused: true } : e)),
      );
    } catch (e) {
      log.warn("could not update the EAS session record", e);
    }
  }

  markUncertain(entry: LedgerEntry): void {
    this.uncertain.set(entry.name, {
      entry,
      until: this.now() + UNCERTAIN_CREATE_MS,
    });
  }

  /** Stop a session and, once Expo confirms, drop it from the ledger. */
  async stop(api: ExpoApi, sessionId: string, name: string): Promise<void> {
    await api.stop(sessionId);
    this.forget(name);
  }

  /** Find recorded sessions by name (an id may never have arrived) and stop them. */
  async stopRecorded(
    api: ExpoApi,
    entries: LedgerEntry[],
  ): Promise<{ found: Set<string>; listed: Set<string> }> {
    const found = new Set<string>();
    const listed = new Set<string>();
    for (const appId of new Set(entries.map((e) => e.appId))) {
      let active: { id: string; name: string }[];
      try {
        active = await api.activeSessions(appId);
      } catch {
        continue;
      }
      listed.add(appId);
      for (const entry of entries.filter((e) => e.appId === appId)) {
        for (const session of active.filter((s) => s.name === entry.name)) {
          found.add(entry.name);
          await this.stop(api, session.id, entry.name).then(
            () => {
              this.unresolved.delete(entry.name);
              capture("eas_session_ended", {
                reason: "leftover",
                duration_bucket: "unknown",
              });
            },
            () => this.unresolved.set(entry.name, session.id),
          );
        }
      }
    }

    return { found, listed };
  }

  /** Records a previous process left count against the limit until a sweep finds them. */
  adopt(owned: Set<string>): void {
    const now = this.now();
    for (const entry of readLedger(this.hostId)) {
      if (!owned.has(entry.name) && !entry.refused) {
        this.uncertain.set(entry.name, {
          entry,
          until: Math.max(entry.recordedAt + UNCERTAIN_CREATE_MS, now),
        });
      }
    }
  }

  /**
   * Stop recorded sessions nothing owns: a previous process's, or a failed or
   * uncertain start's. Records go once a listing confirms Expo no longer runs
   * them, or once no queue could still hold them.
   */
  async reap(api: ExpoApi, owned: Set<string>): Promise<void> {
    if (this.closed) {
      return;
    }
    this.reapedAt = this.now();
    for (const name of this.unresolved.keys()) {
      owned.add(name);
    }
    const leftovers = readLedger(this.hostId).filter((e) => !owned.has(e.name));
    const { found, listed } = await this.stopRecorded(api, leftovers);
    for (const [name, { entry, until }] of this.uncertain) {
      if (
        found.has(name) ||
        (this.reapedAt >= until && listed.has(entry.appId))
      ) {
        this.uncertain.delete(name);
      }
    }
    for (const entry of leftovers) {
      const age = this.reapedAt - entry.recordedAt;
      if (age > RECORD_LIFETIME_MS) {
        this.uncertain.delete(entry.name);
      }
      if (found.has(entry.name)) {
        continue;
      }
      if (
        (age > RECORD_LIFETIME_MS && listed.has(entry.appId)) ||
        age > RECORD_MAX_AGE_MS
      ) {
        this.forget(entry.name);
      }
    }
  }

  /** Retry failed stops; a session Expo already ended is let go either way. */
  async retryUnresolved(api: ExpoApi): Promise<void> {
    for (const [name, sessionId] of [...this.unresolved]) {
      try {
        await this.stop(api, sessionId, name);
        this.unresolved.delete(name);
      } catch {
        const current = await api.session(sessionId).catch(() => null);
        if (current?.status === "STOPPED" || current?.status === "ERRORED") {
          this.forget(name);
          this.unresolved.delete(name);
        }
      }
    }
  }

  /** Without a credential no sweep can look; a record Expo would have listed by now stops counting. */
  expireUncertain(): void {
    const now = this.now();
    for (const [name, { until }] of this.uncertain) {
      if (now >= until) {
        this.uncertain.delete(name);
      }
    }
  }

  /** Whether anything recorded may still be billed. */
  hasOutstanding(): boolean {
    if (this.unresolved.size > 0) {
      return true;
    }
    try {
      return readLedger(this.hostId).some((e) => !e.refused);
    } catch {
      return true;
    }
  }

  /** After removal: no more ledger writes from this instance. */
  close(): void {
    this.closed = true;
  }
}
