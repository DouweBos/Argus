import type { AutomationCalibration } from "../../lib/types";
import { useEffect, useState } from "react";
import { ReportList, SectionPanel, StatCell, StatsStrip } from "@argus/peacock";
import { getAutomationCalibration } from "../../lib/ipc";

/** Below this an automation is costing more attention than it saves. */
const POOR_ACCEPTANCE = 0.5;

function ratePercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * The automation's track record, stated plainly. An automation that is wrong
 * seven times out of ten should read as wrong here rather than just produce a
 * quietly ignored inbox.
 */
export function AutomationTrackRecord({
  automationId,
  refreshKey,
}: {
  automationId: string;
  /** Changes when the run history does, so the record follows it. */
  refreshKey?: number;
}) {
  const calibration = useCalibration(automationId, refreshKey);

  if (!calibration || calibration.sample === 0) {
    return null;
  }

  const { accepted, acceptance_rate, auto_started, dismissed, resolved } =
    calibration;
  const poor =
    acceptance_rate !== null && acceptance_rate < POOR_ACCEPTANCE
      ? "negative"
      : "neutral";

  return (
    <SectionPanel
      title="Track record"
      meta={`last ${calibration.sample} proposal${calibration.sample === 1 ? "" : "s"}`}
    >
      <StatsStrip>
        <StatCell
          label="Acceptance"
          value={ratePercent(acceptance_rate)}
          delta={`${accepted + auto_started + resolved} kept · ${dismissed} dismissed`}
          deltaTone={poor}
        />
        <StatCell label="Auto-started" value={String(auto_started)} />
        <StatCell label="Waiting" value={String(calibration.pending)} />
        <StatCell
          label="Merged"
          value={String(calibration.merged)}
          delta={`${calibration.abandoned} abandoned`}
        />
      </StatsStrip>

      {calibration.dismissals.length > 0 && (
        <ReportList
          items={calibration.dismissals.map((d) => ({
            text: `${d.title} — ${d.reason}`,
            tone: "warning" as const,
          }))}
        />
      )}
    </SectionPanel>
  );
}

function useCalibration(
  automationId: string,
  refreshKey?: number,
): AutomationCalibration | null {
  const [calibration, setCalibration] = useState<AutomationCalibration | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    getAutomationCalibration(automationId)
      .then((c) => live && setCalibration(c))
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [automationId, refreshKey]);

  return calibration;
}
