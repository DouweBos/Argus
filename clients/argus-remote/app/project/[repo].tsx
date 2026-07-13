import { useEffect } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Body, Card, Muted, Screen } from "../../src/components/ui";
import { useAppStore } from "../../src/stores/appStore";

export default function ProjectScreen() {
  const { repo } = useLocalSearchParams<{ repo: string }>();
  const repoRoot = decodeURIComponent(repo ?? "");
  const router = useRouter();

  const sessions = useAppStore((s) => s.sessionsByRepo[repoRoot] ?? []);
  const agentsBySession = useAppStore((s) => s.agentsBySession);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const loadAgents = useAppStore((s) => s.loadAgents);
  const connection = useAppStore((s) => s.connection);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    loadSessions(repoRoot).catch(() => {});
  }, [connection, repoRoot, loadSessions]);

  useEffect(() => {
    for (const s of sessions) {
      loadAgents(s.id).catch(() => {});
    }
  }, [sessions, loadAgents]);

  return (
    <Screen>
      <Stack.Screen options={{ title: repoRoot.split("/").pop() ?? "Project" }} />
      {sessions.length === 0 ? (
        <Muted>No sessions.</Muted>
      ) : (
        sessions.map((s) => {
          const agents = agentsBySession[s.id] ?? [];

          return (
            <Card key={s.id}>
              <Body>{s.display_name ?? s.branch}</Body>
              <Muted>
                {s.branch} · {s.status}
              </Muted>
              {agents.map((a) => (
                <Card
                  key={a.agent_id}
                  style={{ marginTop: 6 }}
                  onPress={() => router.push(`/agent/${a.agent_id}`)}
                >
                  <Muted>
                    agent {a.agent_id.slice(0, 8)} · {a.status}
                    {a.model ? ` · ${a.model}` : ""}
                  </Muted>
                </Card>
              ))}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
