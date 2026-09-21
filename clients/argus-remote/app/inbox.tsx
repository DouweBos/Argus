/**
 * The connected computer's inbox — what its automations want you to decide.
 *
 * The decisions are the half of the inbox worth having on a phone: they arrive
 * while nobody is looking, and answering one is a tap. Accepting starts real
 * work on the computer, so it needs the `control` grant; a monitor-only phone
 * reads the same list with the buttons gone.
 */

import { useCallback } from "react";
import { Stack, useRouter } from "expo-router";
import * as Icons from "../src/components/Icons";
import { ProposalCard } from "../src/components/ProposalCard";
import {
  Banner,
  EmptyState,
  HeaderIconBtn,
  Loading,
  Screen,
  SectionHeader,
} from "../src/components/ui";
import { useLiveRefresh } from "../src/hooks/useLiveRefresh";
import { useAppStore } from "../src/stores/appStore";
import { useProposalsStore } from "../src/stores/proposalsStore";
import { useTheme } from "../src/theme";

export default function InboxScreen() {
  const theme = useTheme();
  const router = useRouter();
  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.capabilities.includes("control"));
  const proposals = useProposalsStore((s) => s.proposals);
  const busy = useProposalsStore((s) => s.busy);
  const loaded = useProposalsStore((s) => s.loaded);
  const error = useProposalsStore((s) => s.error);
  const refreshProposals = useProposalsStore((s) => s.refresh);
  const accept = useProposalsStore((s) => s.accept);
  const dismiss = useProposalsStore((s) => s.dismiss);

  const refresh = useCallback(() => {
    refreshProposals().catch(() => {});
  }, [refreshProposals]);
  useLiveRefresh(connection === "ready", refresh);

  // Accepting spawns the agent that does the work, so go and watch it.
  const start = (proposalId: string, label: string) => {
    accept(proposalId)
      .then((agentId) => {
        if (agentId) {
          router.push({ pathname: "/agent/[id]", params: { id: agentId, label } });
        }
      })
      .catch(() => {});
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: "Inbox",
          headerRight: () => (
            <HeaderIconBtn
              label="Refresh"
              icon={Icons.Refresh}
              disabled={connection !== "ready"}
              onPress={refresh}
            />
          ),
        }}
      />

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {!loaded ? (
        <Loading label="Reading the inbox…" />
      ) : proposals.length === 0 ? (
        <EmptyState
          icon={<Icons.Envelope size={22} color={theme.textMuted} />}
          title="Nothing needs you"
          body="When an automation finds something worth deciding on, it shows up here."
        />
      ) : (
        <>
          <SectionHeader count={proposals.length}>Decide</SectionHeader>
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busy[proposal.id]}
              canDecide={hasControl}
              onAccept={() => start(proposal.id, proposal.title)}
              onDismiss={(reason) => {
                dismiss(proposal.id, reason || undefined).catch(() => {});
              }}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
