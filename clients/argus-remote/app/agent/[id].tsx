import { useEffect } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Body, Btn, Card, Muted, Screen, Title } from "../../src/components/ui";
import { theme } from "../../src/theme";
import { useAppStore } from "../../src/stores/appStore";

export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentId = id ?? "";

  const transcript = useAppStore((s) => s.transcriptByAgent[agentId] ?? []);
  const prompts = useAppStore((s) => s.prompts);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const watchAgent = useAppStore((s) => s.watchAgent);
  const respond = useAppStore((s) => s.respond);
  const connection = useAppStore((s) => s.connection);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    loadTranscript(agentId).catch(() => {});
    watchAgent(agentId, true);

    return () => watchAgent(agentId, false);
  }, [connection, agentId, loadTranscript, watchAgent]);

  const pending = Object.values(prompts).filter((p) => p.agent_id === agentId);

  return (
    <Screen>
      <Stack.Screen options={{ title: `Agent ${agentId.slice(0, 8)}` }} />

      {pending.map((p) => (
        <Card key={p.tool_use_id} style={{ borderColor: theme.warning }}>
          <Title>Permission requested</Title>
          <Body>{p.tool_name}</Body>
          <Muted>{JSON.stringify(p.tool_input)}</Muted>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Btn
              label="Deny"
              tone="danger"
              onPress={() => respond(agentId, p.tool_use_id, "deny")}
            />
            <Btn
              label="Allow"
              tone="primary"
              onPress={() => respond(agentId, p.tool_use_id, "allow")}
            />
          </View>
        </Card>
      ))}

      <Muted>Transcript</Muted>
      {transcript.length === 0 ? (
        <Muted>No messages yet.</Muted>
      ) : (
        transcript.slice(-200).map((line, i) => (
          <Card key={i}>
            <Muted>{truncate(line)}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}

function truncate(s: string): string {
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}
