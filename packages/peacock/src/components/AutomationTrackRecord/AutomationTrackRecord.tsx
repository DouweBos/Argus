import type { AutomationCalibration } from "@argus/remote-protocol";
import { ReportList } from "../ReportView/ReportList";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { StatCell, StatsStrip } from "../StatsStrip/StatsStrip";

/** Below this an automation is costing more attention than it saves. */
const POOR_ACCEPTANCE = 0.5;

function ratePercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * The automation's track record, stated plainly. One that is wrong seven
 * times out of ten should read as wrong here rather than just produce a
 * quietly ignored inbox. Renders nothing until something has been decided.
 */
export function AutomationTrackRecord({
  calibration,
}: {
  calibration: AutomationCalibration | null;
}) {
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
      meta={`last ${calibration.sample} proposal${calibration.sample === 1 ? "" : "s"}`}
      title="Track record"
    >
      <StatsStrip>
        <StatCell
          delta={`${accepted + auto_started + resolved} kept · ${dismissed} dismissed`}
          deltaTone={poor}
          label="Acceptance"
          value={ratePercent(acceptance_rate)}
        />
        <StatCell label="Auto-started" value={String(auto_started)} />
        <StatCell label="Waiting" value={String(calibration.pending)} />
        <StatCell
          delta={`${calibration.abandoned} abandoned`}
          label="Merged"
          value={String(calibration.merged)}
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
