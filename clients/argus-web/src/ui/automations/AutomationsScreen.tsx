/** `/automations`: every automation on the computer. */

import type {
  RemoteAutomation,
  RemoteAutomationRun,
} from "@argus/remote-protocol";
import { useState } from "react";
import {
  formatRelative,
  isRunActive,
  loadPhase,
  newAutomationDraft,
  nextRunLabel,
  scheduleLabel,
} from "@argus/client-core";
import {
  AutomationsListView,
  Banner,
  Button,
  RunStatusBadge,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useLiveRefresh } from "../useLiveRefresh";
import { useInboxRefresh, INBOX_REFRESH_MS } from "./useInbox";

/** Run now, or cancel the run in flight. */
export function RunControl({
  automation,
  latest,
}: {
  automation: Pick<RemoteAutomation, "id" | "running">;
  latest: RemoteAutomationRun | undefined;
}) {
  const triggering = useAutomationsStore((s) =>
    s.triggering.includes(automation.id),
  );
  const { cancelRun, runNow } = useAutomationsStore.getState();
  const active = latest && isRunActive(latest);
  if (active) {
    return (
      <Button size="sm" variant="danger" onClick={() => void cancelRun(latest.id)}>
        Cancel
      </Button>
    );
  }

  return (
    <Button
      disabled={triggering || automation.running}
      size="sm"
      variant="secondary"
      onClick={() => void runNow(automation.id)}
    >
      {triggering || automation.running ? "Running…" : "Run now"}
    </Button>
  );
}

export function AutomationsScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const automations = useAutomationsStore((s) => s.automations);
  const runs = useAutomationsStore((s) => s.runs);
  const load = useAutomationsStore((s) => s.load);
  const error = useAutomationsStore((s) => s.error);
  const { clearError, refresh, save, setEnabled } =
    useAutomationsStore.getState();
  const [creating, setCreating] = useState(false);
  const refreshAll = useInboxRefresh();
  useLiveRefresh(ready, refreshAll, INBOX_REFRESH_MS);

  const create = async () => {
    setCreating(true);
    try {
      const id = await save(null, newAutomationDraft());
      appNavigate({ name: "automation", automationId: id });
    } catch {
      useAutomationsStore.setState({
        error: "Couldn't create an automation — is the computer still there?",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="aw-automations">
      {error && (
        <Banner tone="error" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <AutomationsListView
        creating={creating}
        error={load.error}
        phase={loadPhase(load, automations.length === 0)}
        quickRunCount={runs.filter((r) => r.is_quick).length}
        rows={automations.map((automation) => {
          const latest = runs.find((r) => r.automation_id === automation.id);

          return {
            id: automation.id,
            name: automation.name,
            description: automation.description || undefined,
            trigger: scheduleLabel(automation),
            enabled: automation.enabled,
            enableDisabled: !hasControl,
            lastRunStatus: latest ? (
              <RunStatusBadge status={latest.status} />
            ) : null,
            lastRunLabel: latest ? formatRelative(latest.started_at) : "Never",
            nextRunLabel: nextRunLabel(automation),
            actions: hasControl ? (
              <RunControl automation={automation} latest={latest} />
            ) : undefined,
            onOpen: () =>
              appNavigate({ name: "automation", automationId: automation.id }),
            onToggleEnabled: (enabled: boolean) =>
              void setEnabled(automation.id, enabled),
          };
        })}
        onDescribe={
          hasControl ? () => appNavigate({ name: "describe" }) : undefined
        }
        onNew={hasControl ? () => void create() : undefined}
        onQuickRun={() => appNavigate({ name: "quickRun" })}
        onRetry={() => void refresh().catch(() => {})}
      />
    </div>
  );
}
