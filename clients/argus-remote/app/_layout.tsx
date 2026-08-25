// MUST be first: Hermes has no crypto.getRandomValues; noble needs it.
import "react-native-get-random-values";

import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Btn, Muted, Screen, Title } from "../src/components/ui";
import {
  registerNotificationCategories,
  setNotificationDecider,
  setNotificationOpener,
  startNotificationRouting,
} from "../src/lib/notify";
import { useThemeBootstrap, useTheme } from "../src/theme";
import { useAppStore } from "../src/stores/appStore";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const theme = useTheme();
  const router = useRouter();
  const init = useAppStore((s) => s.init);
  const [unlocked, setUnlocked] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  useThemeBootstrap();

  useEffect(() => {
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setUnlocked(true);
        init();

        return;
      }
      setNeedsAuth(true);
    })();
  }, [init]);

  // Tapping a notification jumps to the agent it came from; its Approve/Deny
  // buttons answer the prompt without opening the app at all. Registered
  // outside the biometric gate so a background tap is never dropped — the
  // answer is queued and sent once the gateway is back.
  useEffect(() => {
    registerNotificationCategories().catch(() => {});
    setNotificationOpener((agentId, label) => {
      router.push({
        pathname: "/agent/[id]",
        params: { id: agentId, label },
      });
    });
    setNotificationDecider((agentId, toolUseId, decision) => {
      useAppStore
        .getState()
        .decidePrompt(agentId, toolUseId, decision)
        .catch(() => {});
    });
    const stop = startNotificationRouting();

    return () => {
      setNotificationOpener(null);
      setNotificationDecider(null);
      stop();
    };
  }, [router]);

  const authenticate = useCallback(async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Argus Remote",
    });
    if (res.success) {
      setNeedsAuth(false);
      setUnlocked(true);
      init();
    }
  }, [init]);

  if (!unlocked) {
    return (
      <Screen>
        <Title>Argus Remote</Title>
        <Muted>Locked. Authenticate to continue.</Muted>
        {needsAuth && <Btn label="Unlock" onPress={authenticate} />}
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style={theme.scheme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bgSecondary },
          headerTintColor: theme.text,
          headerTitleStyle: { fontSize: 16 },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Projects" }} />
        <Stack.Screen name="pair" options={{ title: "Pair a device" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="devices" options={{ title: "Devices" }} />
      </Stack>
    </>
  );
}
