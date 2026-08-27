import { useCallback, useEffect } from "react";
import { useHeaderHeight } from "@react-navigation/elements";
import { Alert, KeyboardAvoidingView, Platform, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AgentTranscript } from "../../src/components/AgentTranscript";
import { ChatInput } from "../../src/components/ChatInput";
import * as Icons from "../../src/components/Icons";
import { Banner, IconBtn, Row } from "../../src/components/ui";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

export default function AgentScreen() {
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const agentId = id ?? "";

  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const stopAgentProcess = useAppStore((s) => s.stopAgentProcess);
  const devices = useAppStore((s) => s.devices);
  const refreshDevices = useAppStore((s) => s.refreshDevices);

  useEffect(() => {
    if (!sessionId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [agentId, sessionId, loadAgentStatus]);

  // Fetched once, not polled: this only decides where the device button goes.
  useEffect(() => {
    if (connection === "ready") {
      refreshDevices().catch(() => {});
    }
  }, [connection, refreshDevices]);

  // Straight to the screen when there's only one device to mean; otherwise
  // the list, which is also what explains an empty one.
  const openDevices = useCallback(() => {
    const only = devices.length === 1 ? devices[0] : null;
    if (only) {
      router.push({
        pathname: "/device/[id]",
        params: { id: only.id, platform: only.platform, name: only.name },
      });

      return;
    }
    router.push("/devices");
  }, [devices, router]);

  // Stopping kills the agent and its queue — not something to do on a mistap.
  const confirmStop = useCallback(() => {
    Alert.alert(
      "Stop this agent?",
      "It stops mid-turn and anything still queued for it is discarded.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop agent",
          style: "destructive",
          onPress: () => {
            stopAgentProcess(agentId)
              .then(() => router.back())
              .catch(() => {});
          },
        },
      ],
    );
  }, [agentId, router, stopAgentProcess]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      // Measured, not guessed: a hardcoded offset is wrong on any device whose
      // header isn't the size it was picked for, and the input ends up under
      // the keyboard.
      keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
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
              <IconBtn label="Devices" onPress={openDevices}>
                <Icons.Simulator size={16} color={theme.textSecondary} />
              </IconBtn>
              {hasControl ? (
                <IconBtn label="Stop agent" onPress={confirmStop}>
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
