import { useCallback, useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { ConnectionBadge } from "../src/components/ConnectionBadge";
import * as Icons from "../src/components/Icons";
import {
  AgentRow,
  agentActivityRank,
  agentAwaitingLabel,
  agentMetaLabel,
  mapAgentStatus,
} from "../src/components/rows";
import {
  Banner,
  Body,
  Card,
  EmptyState,
  HeaderIconBtn,
  Loading,
  Muted,
  Row,
  Screen,
  SectionHeader,
} from "../src/components/ui";
import { useLiveRefresh } from "../src/hooks/useLiveRefresh";
import { hostLabel } from "../src/lib/keystore";
import type { RemoteAgentStatus } from "../src/lib/protocol";
import { useAppStore } from "../src/stores/appStore";
import { useTheme } from "../src/theme";

function toTildePath(absPath: string): string {
  const match = absPath.match(/^(\/(?:Users|home)\/[^/]+)/);

  return match ? absPath.replace(match[1], "~") : absPath;
}

/** The active computer's projects. Reached by picking a computer on the home
 *  screen, which is where an unpaired phone stays. */
export default function ProjectsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const identity = useAppStore((s) => s.identity);
  const hostName = useAppStore((s) =>
    s.identity ? hostLabel(s.identity) : "Argus",
  );
  const loaded = useAppStore((s) => s.loaded);
  const connection = useAppStore((s) => s.connection);
  const projects = useAppStore((s) => s.projects);
  const refreshProjects = useAppStore((s) => s.refreshProjects);
  const loadRecentAgents = useAppStore((s) => s.loadRecentAgents);

  const refresh = useCallback(() => {
    refreshProjects().catch(() => {});
    loadRecentAgents().catch(() => {});
  }, [refreshProjects, loadRecentAgents]);
  useLiveRefresh(Boolean(identity) && connection === "ready", refresh);

  // Nothing to show without a computer to talk to — the home screen is where
  // one gets picked or paired.
  useEffect(() => {
    if (loaded && !identity) {
      router.replace("/");
    }
  }, [loaded, identity, router]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: hostName,
          headerRight: () => (
            <Row gap={2}>
              <ConnectionBadge state={connection} />
              <HeaderIconBtn
                label="Devices"
                icon={Icons.Simulator}
                onPress={() => router.push("/devices")}
              />
              <HeaderIconBtn
                label="Refresh"
                icon={Icons.Refresh}
                disabled={connection !== "ready"}
                onPress={refresh}
              />
              <HeaderIconBtn
                label="Settings"
                icon={Icons.Gear}
                onPress={() => router.push("/settings")}
              />
            </Row>
          ),
        }}
      />

      {connection === "offline" && (
        <Banner>
          Lost the connection to {hostName} — retrying automatically.
        </Banner>
      )}

      <RecentAgents />

      {!loaded || (connection !== "ready" && projects.length === 0) ? (
        <Loading label={`Connecting to ${hostName}…`} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Icons.Folder size={22} color={theme.textMuted} />}
          title="No projects open"
          body={`Open a repository in Argus on ${hostName} and it'll show up here.`}
        />
      ) : (
        <>
          <SectionHeader count={projects.length}>Projects</SectionHeader>
          {projects.map((p) => (
            <Card
              key={p.repo_root}
              onPress={() =>
                router.push({
                  pathname: "/project/[repo]",
                  params: { repo: p.repo_root, name: p.name },
                })
              }
            >
              <Row gap={8}>
                <Icons.Folder size={14} color={theme.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1}>{p.name}</Body>
                  <Muted numberOfLines={1}>{toTildePath(p.repo_root)}</Muted>
                </View>
                <Icons.ChevronRight size={14} color={theme.textMuted} />
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

/** When the agent last showed a sign of life; creation time until it speaks. */
function lastActivityAt(a: RemoteAgentStatus): number {
  return a.last_activity_at ?? a.created_at ?? 0;
}

/** Where the agent is working — "Argus · main" — since the list spans projects. */
function agentLocation(a: RemoteAgentStatus): string | null {
  const parts = [a.project_name, a.session_label].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Agents across all projects, the ones still working (or waiting on you)
 *  first, then the most recently active — a quick jump back to what you're
 *  driving. */
function RecentAgents() {
  const router = useRouter();
  const recentAgents = useAppStore((s) => s.recentAgents);
  const recent = [...recentAgents]
    .sort(
      (a, b) =>
        agentActivityRank(a) - agentActivityRank(b) ||
        lastActivityAt(b) - lastActivityAt(a),
    )
    .slice(0, 8);

  if (recent.length === 0) {
    return null;
  }

  return (
    <>
      <SectionHeader count={recent.length}>Recent agents</SectionHeader>
      {recent.map((a) => {
        const name = a.title?.trim() || `Agent ${a.agent_id.slice(0, 8)}`;

        return (
          <AgentRow
            key={a.agent_id}
            name={name}
            status={mapAgentStatus(a.status)}
            attention={agentAwaitingLabel(a)}
            meta={agentLocation(a) ?? agentMetaLabel(a.status)}
            onPress={() =>
              router.push({
                pathname: "/agent/[id]",
                params: { id: a.agent_id, label: name },
              })
            }
          />
        );
      })}
    </>
  );
}
