import { useEffect } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AgentTranscript } from "../../src/components/AgentTranscript";
import { ChatInput } from "../../src/components/ChatInput";
import * as Icons from "../../src/components/Icons";
import { Banner, IconBtn, Row } from "../../src/components/ui";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

export default function AgentScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const agentId = id ?? "";

  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const stopAgentProcess = useAppStore((s) => s.stopAgentProcess);

  useEffect(() => {
    if (!sessionId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [agentId, sessionId, loadAgentStatus]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 92 : 0}
    >
      <Stack.Screen
        options={{
          title: label ?? `Agent ${agentId.slice(0, 8)}`,
          headerRight: () => (
            <Row gap={2}>
              {sessionId ? (
                <IconBtn
                  label="View changes"
                  onPress={() =>
                    router.push({
                      pathname: "/changes/[session]",
                      params: { session: sessionId, label: label ?? "Session" },
                    })
                  }
                >
                  <Icons.Branch size={16} color={theme.textSecondary} />
                </IconBtn>
              ) : null}
              {hasControl ? (
                <IconBtn
                  label="Stop agent"
                  onPress={() => stopAgentProcess(agentId).catch(() => {})}
                >
                  <Icons.Stop size={16} color={theme.textSecondary} />
                </IconBtn>
              ) : null}
            </Row>
          ),
        }}
      />

      {connection === "offline" && (
        <View style={{ padding: theme.space }}>
          <Banner>Lost the connection to Argus — retrying automatically.</Banner>
        </View>
      )}

      <AgentTranscript agentId={agentId} />

      {hasControl && <ChatInput agentId={agentId} sessionId={sessionId} />}
    </KeyboardAvoidingView>
  );
}
