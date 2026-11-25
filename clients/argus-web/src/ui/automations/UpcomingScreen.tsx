/** `/automations/upcoming`: every scheduled automation and duty's next run. */

import type { UpcomingRun } from "@argus/remote-protocol";
import { useCallback, useRef } from "react";
import {
  upcomingSubtitle,
  upcomingWaitLabel,
  upcomingWhen,
} from "@argus/client-core";
import { Banner, UpcomingRunsView } from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useLiveRefresh } from "../useLiveRefresh";
import { INBOX_REFRESH_MS } from "./useInbox";

function waitOf(run: UpcomingRun) {
  const label = upcomingWaitLabel(run);

  return label
    ? {
        label,
        tone: run.waiting === "paused" ? ("muted" as const) : ("warning" as const),
      }
    : null;
}

export function UpcomingScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const upcoming = useAutomationsStore((s) => s.upcoming);
  const error = useAutomationsStore((s) => s.error);
  const { clearError, loadUpcoming } = useAutomationsStore.getState();
  // Counted once per visit; the polls after it are refreshes.
  const viewed = useRef(false);

  const poll = useCallback(() => {
    const first = !viewed.current;
    viewed.current = true;
    void loadUpcoming(first);
  }, [loadUpcoming]);
  useLiveRefresh(ready, poll, INBOX_REFRESH_MS);

  let phase: Parameters<typeof UpcomingRunsView>[0]["phase"];
  if (upcoming === null) {
    phase = { kind: "loading" };
  } else {
    phase = upcoming.length === 0 ? { kind: "empty" } : { kind: "content" };
  }

  return (
    <div className="aw-automations">
      {error && (
        <Banner tone="error" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <UpcomingRunsView
        phase={phase}
        rows={(upcoming ?? []).map((run) => ({
          id: run.automation_id,
          name: run.name,
          subtitle: upcomingSubtitle(run),
          when: upcomingWhen(run),
          wait: waitOf(run),
          duty: run.teammate_id !== null,
          onOpen: () =>
            appNavigate({ name: "automation", automationId: run.automation_id }),
        }))}
        onRetry={() => void loadUpcoming(false)}
      />
    </div>
  );
}
