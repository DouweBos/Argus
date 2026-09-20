/**
 * One run: how it went, what it cost, and the report it wrote.
 *
 * A run is an ordinary session with an ordinary agent in it, so the transcript
 * is one tap away — that is where you go when the report doesn't answer the
 * question.
 */

import { useCallback } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import * as Icons from "../../src/components/Icons";
import { Markdown } from "../../src/components/Markdown";
import { ReportBlocks } from "../../src/components/ReportBlocks";
import { timeAgo } from "../../src/components/rows";
import {
  Badge,
  Banner,
  Btn,
  Card,
  Loading,
  Mono,
  Muted,
  Row,
  Screen,
  SectionHeader,
} from "../../src/components/ui";
import { useLiveRefresh } from "../../src/hooks/useLiveRefresh";
import { runCost, runDuration, runTone } from "../../src/lib/automations";
import { useAppStore } from "../../src/stores/appStore";
import {
  isRunActive,
  useAutomationsStore,
} from "../../src/stores/automationsStore";
import { useTheme } from "../../src/theme";

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Muted>{label}</Muted>
      <Mono>{value}</Mono>
    </View>
  );
}

export default function RunScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.capabilities.includes("control"));
  const detail = useAutomationsStore((s) => s.detailByRun[id]);
  const error = useAutomationsStore((s) => s.error);
  const loadRun = useAutomationsStore((s) => s.loadRun);
  const cancelRun = useAutomationsStore((s) => s.cancelRun);

  // A finished run's report never changes, so stop polling once it has one.
  const settled = detail !== undefined && !isRunActive(detail.run);
  const refresh = useCallback(() => {
    loadRun(id).catch(() => {});
  }, [id, loadRun]);
  useLiveRefresh(connection === "ready" && !settled, refresh);

  if (!detail) {
    return (
      <Screen>
        <Stack.Screen options={{ title: label ?? "Run" }} />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Loading label="Reading the run…" />
      </Screen>
    );
  }

  const { run, report_blocks: blocks, report_markdown: markdown } = detail;
  const active = isRunActive(run);

  return (
    <Screen>
      <Stack.Screen options={{ title: run.automation_name }} />

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card>
        <Row gap={8}>
          <Badge label={run.status} tone={runTone(run.status)} />
          <Muted style={{ flex: 1 }} numberOfLines={1}>
            {run.trigger_reason}
          </Muted>
          {run.is_quick ? <Badge label="quick" tone="muted" /> : null}
        </Row>
        <Row gap={20}>
          <Figure label="Started" value={timeAgo(run.started_at)} />
          <Figure label="Duration" value={runDuration(run)} />
          <Figure label="Cost" value={runCost(run.cost_usd)} />
        </Row>
        {run.error ? <Banner tone="warning">{run.error}</Banner> : null}

        <Row gap={8}>
          {run.host_agent_id ? (
            <Btn
              label="Open agent"
              tone="secondary"
              size="sm"
              icon={<Icons.Agent size={12} color={theme.text} />}
              onPress={() =>
                router.push({
                  pathname: "/agent/[id]",
                  params: {
                    id: run.host_agent_id as string,
                    label: run.automation_name,
                  },
                })
              }
            />
          ) : null}
          {hasControl && active ? (
            <Btn
              label="Cancel"
              tone="danger"
              size="sm"
              onPress={() => {
                cancelRun(run.id).catch(() => {});
              }}
            />
          ) : null}
        </Row>
      </Card>

      {blocks && blocks.length > 0 ? (
        <>
          <SectionHeader>Report</SectionHeader>
          <ReportBlocks blocks={blocks} />
        </>
      ) : markdown ? (
        <>
          <SectionHeader>Report</SectionHeader>
          <Card>
            <Markdown text={markdown} />
          </Card>
        </>
      ) : (
        <Muted>
          {active
            ? "Still running — the report lands when it finishes."
            : "No report."}
        </Muted>
      )}
    </Screen>
  );
}
