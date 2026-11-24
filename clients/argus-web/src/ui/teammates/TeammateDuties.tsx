/**
 * `/teammates/:id/duties`: the automations it runs, each opening on the
 * automation screen. Moving a standalone automation in moves its memories.
 */

import { useEffect, useRef, useState } from "react";
import {
  formatRelative,
  nextRunLabel,
  scheduleLabel,
} from "@argus/client-core";
import {
  Banner,
  Button,
  OptionMenu,
  RunStatusBadge,
  TeammateDutiesPanel,
  TeammatePageBar,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { showTeammatePage } from "./teammateNav";

/** "Move an automation here": the standalone automations, searchable. */
function MoveAutomationButton({ teammateId }: { teammateId: string }) {
  const automations = useAutomationsStore((s) => s.automations);
  const standalone = automations.filter((a) => !a.teammate_id);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);

  const move = async (automationId: string) => {
    setMoving(true);
    await useTeammatesStore.getState().promote(automationId, teammateId);
    setMoving(false);
  };

  return (
    <>
      <span ref={trigger}>
        <Button
          disabled={moving || standalone.length === 0}
          size="sm"
          variant="secondary"
          onClick={() => setOpen((o) => !o)}
        >
          Move an automation here
        </Button>
      </span>
      {open && (
        <OptionMenu
          items={standalone.map((a) => ({ value: a.id, label: a.name }))}
          placeholder="Move an automation here"
          triggerRef={trigger}
          onClose={() => setOpen(false)}
          onSelect={(id) => void move(id)}
        />
      )}
    </>
  );
}

export function TeammateDuties({ teammateId }: { teammateId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const duties = useTeammatesStore((s) => s.detailById[teammateId]?.duties);
  const error = useTeammatesStore((s) => s.error);
  const runs = useAutomationsStore((s) => s.runs);
  const { clearError, loadDetail, removeDuty } = useTeammatesStore.getState();

  useEffect(() => {
    if (ready) {
      void useAutomationsStore
        .getState()
        .refresh({ background: true })
        .catch(() => {});
    }
  }, [ready]);

  const setEnabled = async (automationId: string, enabled: boolean) => {
    await useAutomationsStore.getState().setEnabled(automationId, enabled);
    await loadDetail(teammateId).catch(() => {});
  };

  return (
    <div className="aw-automations">
      <TeammatePageBar
        page="duties"
        onPage={(page) => showTeammatePage(teammateId, page)}
      />
      {error && (
        <Banner tone="error" onDismiss={clearError}>
          {error}
        </Banner>
      )}
      <TeammateDutiesPanel
        action={hasControl && <MoveAutomationButton teammateId={teammateId} />}
        rows={(duties ?? []).map((duty) => {
          const latest = runs.find((r) => r.automation_id === duty.id);

          return {
            id: duty.id,
            name: duty.name,
            description: duty.description || undefined,
            trigger: scheduleLabel(duty),
            enabled: duty.enabled,
            enableDisabled: !hasControl,
            lastRunStatus: latest ? (
              <RunStatusBadge status={latest.status} />
            ) : null,
            lastRunLabel: latest ? formatRelative(latest.started_at) : "Never",
            nextRunLabel: nextRunLabel(duty),
            actions: hasControl ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void removeDuty(teammateId, duty.id)}
              >
                Remove from teammate
              </Button>
            ) : undefined,
            onOpen: () =>
              appNavigate({ name: "automation", automationId: duty.id }),
            onToggleEnabled: (enabled: boolean) =>
              void setEnabled(duty.id, enabled),
          };
        })}
      />
    </div>
  );
}
