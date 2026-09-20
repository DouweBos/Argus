/**
 * The connected computer's automations, and what they have been doing.
 *
 * Automations are the one thing in Argus that happens while nobody is looking,
 * which is exactly what you want to check from a phone. Polls, like every
 * other list here — there is no push channel for the set.
 */

import { useCallback } from "react";
import { Stack, useRouter } from "expo-router";
import * as Icons from "../src/components/Icons";
import { AutomationRow, RunRow } from "../src/components/runRows";
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
import { useAutomationsStore } from "../src/stores/automationsStore";
import { useTheme } from "../src/theme";

/** Enough to see what fired overnight without scrolling past the automations. */
const RECENT_RUNS = 8;

export default function AutomationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const connection = useAppStore((s) => s.connection);
  const automations = useAutomationsStore((s) => s.automations);
  const runs = useAutomationsStore((s) => s.runs);
  const loaded = useAutomationsStore((s) => s.loaded);
  const error = useAutomationsStore((s) => s.error);
  const refreshAutomations = useAutomationsStore((s) => s.refresh);

  const refresh = useCallback(() => {
    refreshAutomations().catch(() => {});
  }, [refreshAutomations]);
  useLiveRefresh(connection === "ready", refresh);

  const recent = runs.slice(0, RECENT_RUNS);

  return (
    <Screen>
      <Stack.Screen
        options={{
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
        <Loading label="Reading automations…" />
      ) : automations.length === 0 && runs.length === 0 ? (
        <EmptyState
          icon={<Icons.Clock size={22} color={theme.textMuted} />}
          title="No automations"
          body="Create one in Argus on your computer and it'll show up here, along with everything it runs."
        />
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <SectionHeader count={recent.length}>Recent runs</SectionHeader>
              {recent.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  showName
                  onPress={() =>
                    router.push({
                      pathname: "/run/[id]",
                      params: { id: run.id, label: run.automation_name },
                    })
                  }
                />
              ))}
            </>
          )}

          {automations.length > 0 && (
            <>
              <SectionHeader count={automations.length}>
                Automations
              </SectionHeader>
              {automations.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  onPress={() =>
                    router.push({
                      pathname: "/automation/[id]",
                      params: { id: automation.id, label: automation.name },
                    })
                  }
                />
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
