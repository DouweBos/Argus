/**
 * One automation: what it is, when it next fires, and every time it has run.
 *
 * Run now is the only thing this screen changes, and it needs the `control`
 * grant — firing an automation starts an agent on the computer. Without it the
 * button is absent rather than disabled, because a monitor device is never
 * going to get it by tapping.
 */

import { useCallback, useMemo } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import * as Icons from "../../src/components/Icons";
import { RunRow } from "../../src/components/runRows";
import {
  Badge,
  Banner,
  Body,
  Btn,
  Card,
  EmptyState,
  Loading,
  Muted,
  Row,
  Screen,
  SectionHeader,
} from "../../src/components/ui";
import { useLiveRefresh } from "../../src/hooks/useLiveRefresh";
import { triggerLabel, untilLabel } from "../../src/lib/automations";
import { useAppStore } from "../../src/stores/appStore";
import {
  isRunActive,
  useAutomationsStore,
} from "../../src/stores/automationsStore";
import { useTheme } from "../../src/theme";

export default function AutomationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.capabilities.includes("control"));
  const automation = useAutomationsStore((s) =>
    s.automations.find((a) => a.id === id),
  );
  // Select the whole list and narrow it here — a selector that returns a new
  // array every call re-renders forever under zustand's snapshot comparison.
  const allRuns = useAutomationsStore((s) => s.runs);
  const runs = useMemo(
    () => allRuns.filter((r) => r.automation_id === id),
    [allRuns, id],
  );
  const triggering = useAutomationsStore((s) => Boolean(s.triggering[id]));
  const error = useAutomationsStore((s) => s.error);
  const refreshAutomations = useAutomationsStore((s) => s.refresh);
  const runNow = useAutomationsStore((s) => s.runNow);
  const cancelRun = useAutomationsStore((s) => s.cancelRun);

  const refresh = useCallback(() => {
    refreshAutomations().catch(() => {});
  }, [refreshAutomations]);
  useLiveRefresh(connection === "ready", refresh);

  const activeRun = runs.find(isRunActive) ?? null;

  if (!automation) {
    return (
      <Screen>
        <Stack.Screen options={{ title: label ?? "Automation" }} />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Loading label="Reading the automation…" />
      </Screen>
    );
  }

  const next = untilLabel(automation.next_run_at);

  return (
    <Screen>
      <Stack.Screen options={{ title: automation.name }} />

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card>
        <Row gap={8}>
          <Icons.Clock size={14} color={theme.textSecondary} />
          <Body style={{ flex: 1 }}>{triggerLabel(automation)}</Body>
          <Badge
            label={automation.enabled ? "Enabled" : "Paused"}
            tone={automation.enabled ? "success" : "muted"}
          />
        </Row>
        {automation.description ? (
          <Muted>{automation.description}</Muted>
        ) : null}
        <Row gap={10}>
          {automation.enabled && next ? <Muted>Next run {next}</Muted> : null}
          {automation.autonomy ? (
            <Muted>Autonomy: {automation.autonomy.replace("_", " ")}</Muted>
          ) : null}
        </Row>
        {automation.projects.length > 0 && (
          <Muted numberOfLines={2}>
            Projects: {automation.projects.join(", ")}
          </Muted>
        )}

        {hasControl && (
          <View style={{ marginTop: 4 }}>
            {activeRun ? (
              <Btn
                label="Cancel run"
                tone="danger"
                size="sm"
                onPress={() => {
                  cancelRun(activeRun.id).catch(() => {});
                }}
              />
            ) : (
              <Btn
                label={triggering ? "Starting…" : "Run now"}
                icon={<Icons.Play size={12} color={theme.bg} />}
                size="sm"
                disabled={triggering || connection !== "ready"}
                onPress={() => {
                  runNow(automation.id).catch(() => {});
                }}
              />
            )}
          </View>
        )}
      </Card>

      {runs.length === 0 ? (
        <EmptyState
          icon={<Icons.History size={22} color={theme.textMuted} />}
          title="Never run"
          body={
            hasControl
              ? "Press Run now to see what it does."
              : "This device can watch automations but not start them."
          }
        />
      ) : (
        <>
          <SectionHeader count={runs.length}>Runs</SectionHeader>
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              onPress={() =>
                router.push({
                  pathname: "/run/[id]",
                  params: { id: run.id, label: automation.name },
                })
              }
            />
          ))}
        </>
      )}
    </Screen>
  );
}
