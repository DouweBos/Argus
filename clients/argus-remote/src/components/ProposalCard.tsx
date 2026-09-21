/**
 * One decision, as a card — the RN twin of Peacock's `ProposalCard`.
 *
 * Three actions at most: the one the run asked for, dismiss (with an optional
 * reason), and open the work item it came from. The reason is an inline field
 * rather than a prompt, for the same reason it is on the desktop: it is the
 * signal that teaches the automation, so asking for it must cost nothing.
 */

import { useState } from "react";
import { Linking, View } from "react-native";
import type { RemoteProposal } from "../lib/protocol";
import { useTheme } from "../theme";
import * as Icons from "./Icons";
import { Markdown } from "./Markdown";
import { timeAgo } from "./rows";
import { Badge, Body, Btn, Card, Muted, Row, TextField } from "./ui";

export function ProposalCard({
  proposal,
  busy,
  canDecide,
  onAccept,
  onDismiss,
}: {
  proposal: RemoteProposal;
  busy?: boolean;
  /** False on a monitor-only phone: the computer would refuse either button. */
  canDecide: boolean;
  onAccept: () => void;
  onDismiss: (reason: string) => void;
}) {
  const theme = useTheme();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const cta = proposal.cta;

  const confirmDismiss = () => {
    setDismissing(false);
    onDismiss(reason.trim());
    setReason("");
  };

  return (
    <Card>
      <Body>{proposal.title}</Body>
      <Markdown text={proposal.summary} />
      {proposal.rationale ? <Muted>{proposal.rationale}</Muted> : null}

      <Row gap={6}>
        <Badge
          label={`${Math.round(proposal.confidence * 100)}% sure`}
          tone={proposal.confidence >= 0.7 ? "success" : "muted"}
        />
        {proposal.project ? (
          <Badge label={proposal.project} tone="muted" />
        ) : null}
        <Badge label={proposal.automation_name} tone="muted" />
        <Muted>{timeAgo(proposal.created_at)}</Muted>
      </Row>

      {dismissing ? (
        <View style={{ gap: 8 }}>
          <TextField
            value={reason}
            onChangeText={setReason}
            placeholder="Why? (optional)"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={confirmDismiss}
          />
          <Row gap={8}>
            <Btn
              label="Dismiss"
              tone="danger"
              size="sm"
              disabled={busy}
              onPress={confirmDismiss}
            />
            <Btn
              label="Cancel"
              tone="ghost"
              size="sm"
              onPress={() => setDismissing(false)}
            />
          </Row>
        </View>
      ) : (
        <Row gap={8}>
          {canDecide && cta?.kind === "start_session" ? (
            <Btn
              label={cta.label}
              size="sm"
              disabled={busy}
              icon={<Icons.Play size={11} color={theme.onAccent} />}
              onPress={onAccept}
            />
          ) : null}
          {cta?.kind === "open_url" && cta.url ? (
            <Btn
              label={cta.label}
              tone="secondary"
              size="sm"
              onPress={() => {
                Linking.openURL(cta.url as string).catch(() => {});
              }}
            />
          ) : null}
          {canDecide ? (
            <Btn
              label="Dismiss"
              tone="ghost"
              size="sm"
              disabled={busy}
              onPress={() => setDismissing(true)}
            />
          ) : null}
          {proposal.source_url ? (
            <Btn
              label={proposal.source_label ?? "Source"}
              tone="ghost"
              size="sm"
              onPress={() => {
                Linking.openURL(proposal.source_url as string).catch(() => {});
              }}
            />
          ) : null}
        </Row>
      )}
    </Card>
  );
}
