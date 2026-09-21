/**
 * Rows for the automation screens — the RN twins of Peacock's `AutomationRow`
 * and `RunHistoryRow`.
 */

import { View } from "react-native";
import {
  runCost,
  runDuration,
  runTone,
  triggerLabel,
  untilLabel,
} from "../lib/automations";
import type { RemoteAutomation, RemoteAutomationRun } from "../lib/protocol";
import { useTheme } from "../theme";
import * as Icons from "./Icons";
import { timeAgo } from "./rows";
import { Badge, Body, Card, Mono, Muted, Row, StatusDot } from "./ui";

export function AutomationRow({
  automation,
  onPress,
}: {
  automation: RemoteAutomation;
  onPress: () => void;
}) {
  const theme = useTheme();
  const next = untilLabel(automation.next_run_at);
  // A paused automation still runs by hand, so say "paused", not "off".
  const state = automation.running
    ? "running"
    : automation.enabled
      ? (next ?? "enabled")
      : "paused";

  return (
    <Card onPress={onPress} style={{ paddingVertical: 10 }}>
      <Row gap={9}>
        <StatusDot
          tone={
            automation.running
              ? "accent"
              : automation.enabled
                ? "success"
                : "muted"
          }
          pulse={automation.running}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Body numberOfLines={1}>{automation.name}</Body>
          <Row gap={6}>
            <Muted>{triggerLabel(automation)}</Muted>
            <Muted numberOfLines={1}>· {state}</Muted>
          </Row>
        </View>
        <Icons.ChevronRight size={14} color={theme.textMuted} />
      </Row>
    </Card>
  );
}

export function RunRow({
  run,
  showName,
  onPress,
}: {
  run: RemoteAutomationRun;
  /** Name the automation — needed in a list that spans several of them. */
  showName?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Card onPress={onPress} style={{ paddingVertical: 10 }}>
      <Row gap={9}>
        <Badge label={run.status} tone={runTone(run.status)} />
        <View style={{ flex: 1, gap: 2 }}>
          {showName ? (
            <Body numberOfLines={1}>{run.automation_name}</Body>
          ) : null}
          <Row gap={6}>
            <Muted>{timeAgo(run.started_at)}</Muted>
            <Muted numberOfLines={1}>· {run.trigger_reason}</Muted>
          </Row>
          {run.error ? (
            <Muted numberOfLines={2} style={{ color: theme.textSecondary }}>
              {run.error}
            </Muted>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Mono>{runDuration(run)}</Mono>
          <Mono>{runCost(run.cost_usd)}</Mono>
        </View>
      </Row>
    </Card>
  );
}
