/** `/automations/quick`: run a playbook once, and every quick run so far. */

import { useCallback, useEffect } from "react";
import { automationProjectOptions, isRunActive } from "@argus/client-core";
import {
  Button,
  QuickRunView,
  remoteRunEntry,
  RunHistory,
  Spinner,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useLiveRefresh } from "../useLiveRefresh";
import { INBOX_REFRESH_MS } from "./useInbox";

export function QuickRunScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const projects = useProjectsStore((s) => s.projects);
  const quickRuns = useAutomationsStore((s) => s.quickRuns);
  const error = useAutomationsStore((s) => s.error);
  const store = useAutomationsStore.getState;

  useEffect(() => {
    if (ready && projects.length === 0) {
      void useProjectsStore
        .getState()
        .refreshProjects({ background: true })
        .catch(() => {});
    }
  }, [ready, projects.length]);

  const poll = useCallback(() => void store().loadQuickRuns(), [store]);
  useLiveRefresh(ready, poll, INBOX_REFRESH_MS);

  return (
    <div className="aw-automations">
      <QuickRunView
        error={error}
        history={
          quickRuns === null ? (
            <Spinner />
          ) : (
            <RunHistory
              actions={(run) =>
                hasControl && isRunActive(run) ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void store().cancelRun(run.id)}
                  >
                    Cancel
                  </Button>
                ) : undefined
              }
              empty="Nothing yet. A quick run is kept and swept like any other run."
              runs={quickRuns.map((r) => remoteRunEntry(r, true))}
              title="Quick runs"
              onOpen={(runId) => appNavigate({ name: "quickRunDetail", runId })}
            />
          )
        }
        projects={automationProjectOptions(projects, [])}
        onRun={
          hasControl
            ? async (spec) => {
                const run = await store().runScratch(spec);
                // Straight to the run: watching it is the point of pressing the button.
                appNavigate({ name: "quickRunDetail", runId: run.id });
              }
            : undefined
        }
      />
    </div>
  );
}
