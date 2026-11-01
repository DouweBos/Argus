import type { AutomationCalibration } from "../../lib/types";
import { useEffect, useState } from "react";
import { AutomationTrackRecord as TrackRecord } from "@argus/peacock";
import { getAutomationCalibration } from "../../lib/ipc";

/** The automation's track record, refetched as its run history moves. */
export function AutomationTrackRecord({
  automationId,
  refreshKey,
}: {
  automationId: string;
  /** Changes when the run history does, so the record follows it. */
  refreshKey?: number;
}) {
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

  return <TrackRecord calibration={calibration} />;
}
