import type { ClaudeUsage } from "../../../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, UsageMeter, type UsageTone } from "@argus/peacock";
import {
  getClaudeUsage,
  installClaudeStatuslineHook,
  uninstallClaudeStatuslineHook,
} from "../../../lib/ipc";
import { createLogger } from "../../../lib/logger";
import styles from "./ClaudeUsageIndicator.module.css";

const POLL_INTERVAL_MS = 5_000;
const TICK_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60_000;

const log = createLogger("usage-indicator");

function formatCountdown(targetMs: number, now: number): string {
  const ms = targetMs - now;
  if (ms <= 0) {
    return "resetting…";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;

    return `${d}d ${rh}h`;
  }
  if (h > 0) {
    return `${h}h ${m}m`;
  }

  return `${m}m`;
}

function formatAge(ms: number): string {
  if (ms < 60_000) {
    return "just now";
  }
  const m = Math.floor(ms / 60_000);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);

  return `${h}h ago`;
}

function toneForPct(pct: number | null | undefined): UsageTone {
  if (pct == null) {
    return "accent";
  }
  if (pct >= 90) {
    return "danger";
  }
  if (pct >= 70) {
    return "warning";
  }

  return "accent";
}

// Claude Code's statusline emits resets_at either as ISO-8601 strings or
// Unix epoch seconds, depending on version. Normalize to ms.
function resetsAtToMs(
  value: number | string | null | undefined,
): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  const t = Date.parse(value);

  return Number.isFinite(t) ? t : null;
}

export function ClaudeUsageIndicator() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getClaudeUsage();
        if (!cancelled) {
          setUsage(data);
        }
      } catch (err) {
        log.warn("failed to load claude usage", err);
      }
    };
    load();
    const poll = window.setInterval(load, POLL_INTERVAL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);

    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const derived = useMemo(() => {
    if (!usage?.payload) {
      return null;
    }
    const rl = usage.payload.rate_limits ?? {};
    const fiveHour = rl.five_hour ?? { used_percentage: null, resets_at: null };
    const sevenDay = rl.seven_day ?? { used_percentage: null, resets_at: null };
    const ctx = usage.payload.context_window?.used_percentage ?? null;
    const cost = usage.payload.cost?.total_cost_usd ?? null;
    const model = usage.payload.model?.display_name ?? null;
    const age = usage.file_mtime_ms ? now - usage.file_mtime_ms : null;
    const stale = age != null && age > STALE_THRESHOLD_MS;

    return {
      age,
      cost,
      ctx,
      fiveHour: {
        pct: fiveHour.used_percentage,
        resetsAt: resetsAtToMs(fiveHour.resets_at),
      },
      model,
      sevenDay: {
        pct: sevenDay.used_percentage,
        resetsAt: resetsAtToMs(sevenDay.resets_at),
      },
      stale,
    };
  }, [usage, now]);

  const install = async () => {
    setInstalling(true);
    try {
      await installClaudeStatuslineHook();
      const data = await getClaudeUsage();
      setUsage(data);
    } catch (err) {
      log.warn("failed to install statusline hook", err);
    } finally {
      setInstalling(false);
    }
  };

  const uninstall = async () => {
    setInstalling(true);
    try {
      await uninstallClaudeStatuslineHook();
      const data = await getClaudeUsage();
      setUsage(data);
    } catch (err) {
      log.warn("failed to uninstall statusline hook", err);
    } finally {
      setInstalling(false);
    }
  };

  if (!usage) {
    return null;
  }

  const hasData = derived != null;
  const hookInstalled = usage.hook_installed;

  const compactValue = (pct: number | null) =>
    pct == null ? "—" : `${Math.round(pct)}%`;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-label="Claude usage"
      >
        <UsageMeter
          className={styles.compact}
          label="5h"
          value={compactValue(derived?.fiveHour.pct ?? null)}
          progress={(derived?.fiveHour.pct ?? 0) / 100}
          tone={toneForPct(derived?.fiveHour.pct)}
        />
        <UsageMeter
          className={styles.compact}
          label="7d"
          value={compactValue(derived?.sevenDay.pct ?? null)}
          progress={(derived?.sevenDay.pct ?? 0) / 100}
          tone={toneForPct(derived?.sevenDay.pct)}
        />
      </button>

      {open && (
        <div className={styles.popover} role="dialog">
          <div className={styles.header}>
            <span>Claude usage</span>
            {derived?.model && (
              <span className={styles.model}>{derived.model}</span>
            )}
          </div>

          {!hookInstalled && (
            <div className={styles.setup}>
              <div className={styles.setupBody}>
                Install the Argus statusline tap so Claude Code feeds live
                rate-limit and context usage into this panel. Reversible — your
                existing statusline keeps working.
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={installing}
                onClick={install}
              >
                {installing ? "Installing…" : "Install statusline tap"}
              </Button>
            </div>
          )}

          {hookInstalled && !hasData && (
            <div className={styles.setup}>
              <div className={styles.setupBody}>
                Tap installed. Open an interactive Claude Code session in a
                terminal — the statusline will populate this panel on next
                render.
              </div>
            </div>
          )}

          {hasData && derived && (
            <>
              <UsageMeter
                label="5h session"
                value={`${Math.round(derived.fiveHour.pct ?? 0)}%`}
                progress={(derived.fiveHour.pct ?? 0) / 100}
                tone={toneForPct(derived.fiveHour.pct)}
                hint={
                  derived.fiveHour.resetsAt
                    ? `resets in ${formatCountdown(derived.fiveHour.resetsAt, now)}`
                    : undefined
                }
              />
              <UsageMeter
                label="7d weekly"
                value={`${Math.round(derived.sevenDay.pct ?? 0)}%`}
                progress={(derived.sevenDay.pct ?? 0) / 100}
                tone={toneForPct(derived.sevenDay.pct)}
                hint={
                  derived.sevenDay.resetsAt
                    ? `resets in ${formatCountdown(derived.sevenDay.resetsAt, now)}`
                    : undefined
                }
              />
              {derived.ctx != null && (
                <UsageMeter
                  label="Context window"
                  value={`${Math.round(derived.ctx)}%`}
                  progress={derived.ctx / 100}
                  tone={toneForPct(derived.ctx)}
                />
              )}
              {derived.cost != null && (
                <div className={styles.meta}>
                  <span>Session cost</span>
                  <span className={styles.metaValue}>
                    ${derived.cost.toFixed(2)}
                  </span>
                </div>
              )}
              <div className={styles.footnote}>
                {derived.stale ? "⚠ " : ""}Updated{" "}
                {derived.age != null ? formatAge(derived.age) : "unknown"} via
                statusline tap.
              </div>
            </>
          )}

          {hookInstalled && (
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="ghost"
                disabled={installing}
                onClick={uninstall}
              >
                Uninstall tap
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
