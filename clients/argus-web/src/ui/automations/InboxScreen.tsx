/**
 * `/inbox`: what the computer's automations want from you, in the Mac's
 * groups — Peacock's `InboxView`, fed from the gateway.
 */

import type {
  RemoteAutomationRun,
  RemoteProposal,
} from "@argus/remote-protocol";
import { useEffect } from "react";
import { formatRelative, isInboxEmpty, loadPhase } from "@argus/client-core";
import { Banner, Button, InboxView, type InboxRunItem } from "@argus/peacock";
import { openAgent } from "../../routing/open";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";
import { useProjectsStore } from "../../stores/projects";
import { useProposalsStore } from "../../stores/proposals";
import { useLiveRefresh } from "../useLiveRefresh";
import { ProposalCardFor } from "./ProposalCardFor";
import { runScreen } from "./runRoute";
import {
  INBOX_REFRESH_MS,
  useInboxGroups,
  useInboxRefresh,
} from "./useInbox";

function runItem(
  run: RemoteAutomationRun,
  subtitle: string,
  onDismiss: (() => void) | undefined,
): InboxRunItem {
  return {
    id: run.id,
    title: run.automation_name,
    subtitle,
    when: formatRelative(run.started_at),
    onOpen: () => appNavigate(runScreen(run)),
    onDismiss,
  };
}

function openStarted(proposal: RemoteProposal): void {
  if (proposal.agent_id && proposal.session_id) {
    openAgent({ agent_id: proposal.agent_id, session_id: proposal.session_id });
  } else {
    appNavigate({ name: "proposal", proposalId: proposal.id });
  }
}

export function InboxScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const load = useProposalsStore((s) => s.load);
  const error = useProposalsStore((s) => s.error);
  const automationCount = useAutomationsStore((s) => s.automations.length);
  const dismissRun = useAutomationsStore((s) => s.dismissRun);
  const groups = useInboxGroups();
  const refresh = useInboxRefresh();
  useLiveRefresh(ready, refresh, INBOX_REFRESH_MS);

  // Started work is listed only while its session still exists.
  useEffect(() => {
    if (ready) {
      void useProjectsStore
        .getState()
        .loadRecentAgents()
        .catch(() => {});
    }
  }, [ready]);

  const dismiss = (run: RemoteAutomationRun) =>
    hasControl ? () => void dismissRun(run.id) : undefined;

  return (
    <div className="aw-automations">
      {error && (
        <Banner
          tone="error"
          onDismiss={() => useProposalsStore.getState().clearError()}
        >
          {error}
        </Banner>
      )}
      <InboxView
        cleared={groups.cleared.map((p) => ({
          id: p.id,
          title: p.title,
          subtitle: [
            p.cleared_reason ?? "No reason recorded.",
            p.automation_name,
            p.cleared_at ? formatRelative(p.cleared_at) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          badge: p.status === "superseded" ? "replaced" : "withdrawn",
          onOpen: () => appNavigate({ name: "proposal", proposalId: p.id }),
        }))}
        decide={groups.pending.map((p) => (
          <ProposalCardFor key={p.id} proposal={p} />
        ))}
        emptyAction={
          <Button size="sm" onClick={() => appNavigate({ name: "automations" })}>
            {automationCount === 0 ? "Set up an automation" : "Automations"}
          </Button>
        }
        emptyBody={
          automationCount === 0
            ? "Turn on an automation and whatever it finds — issues to pick up, work it has already started — shows up here."
            : "Your automations have nothing waiting on you. This is what a quiet inbox looks like."
        }
        error={load.error}
        failed={groups.failed.map((r) =>
          runItem(r, r.error ?? "No error recorded.", dismiss(r)),
        )}
        pendingCount={groups.pending.length}
        phase={loadPhase(load, isInboxEmpty(groups))}
        reports={groups.reports.map((r) =>
          runItem(
            r,
            r.report_preview ?? r.trigger_reason,
            dismiss(r),
          ),
        )}
        started={groups.started.map((p) => ({
          id: p.id,
          title: p.title,
          subtitle: p.project ?? undefined,
          badge: {
            label: p.status === "auto_started" ? "auto-started" : "in progress",
            tone: "neutral" as const,
          },
          onOpen: () => openStarted(p),
        }))}
        onRetry={refresh}
      />
    </div>
  );
}
