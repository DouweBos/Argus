import { useCallback, useEffect } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AgentTranscript } from "../../src/components/AgentTranscript";
import { ChatInput } from "../../src/components/ChatInput";
import * as Icons from "../../src/components/Icons";
import { Banner, IconBtn, Row, useKeyboardInset } from "../../src/components/ui";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

export default function AgentScreen() {
  const theme = useTheme();
  const keyboardInset = useKeyboardInset();
  const router = useRouter();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const agentId = id ?? "";

  const connection = useAppStore((s) => s.connection);
  const hasControl = useAppStore((s) => s.hasControl());
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const isRunning = useAppStore(
    (s) => s.statusByAgent[agentId]?.status === "running",
  );
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

  // Shutting down kills the agent process and its queue — not a mistap action.
  const confirmStop = useCallback(() => {
    Alert.alert(
      "Shut down this agent?",
      isRunning
        ? "It stops mid-turn and anything still queued for it is discarded."
        : "Its process ends and anything still queued for it is discarded.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Shut down",
          style: "destructive",
          onPress: () => {
            stopAgentProcess(agentId)
              .then(() => router.back())
              .catch(() => {});
          },
        },
      ],
    );
  }, [agentId, isRunning, router, stopAgentProcess]);

  return (
    // Padding by the keyboard's measured height keeps the transcript ending
    // exactly at the input's top edge, so nothing is ever hidden behind either.
    <View
      style={{ flex: 1, backgroundColor: theme.bg, paddingBottom: keyboardInset }}
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
                <IconBtn label="Shut down agent" onPress={confirmStop}>
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
    </View>
  );
}
