// MUST be first: Hermes has no crypto.getRandomValues; noble needs it.
import "react-native-get-random-values";

import { useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Btn, Muted, Screen, Title } from "../src/components/ui";
import { theme } from "../src/theme";
import { useAppStore } from "../src/stores/appStore";

export default function RootLayout() {
  const init = useAppStore((s) => s.init);
  const [unlocked, setUnlocked] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

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

  const authenticate = async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Argus Remote",
    });
    if (res.success) {
      setNeedsAuth(false);
      setUnlocked(true);
      init();
    }
  };

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
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Projects" }} />
        <Stack.Screen name="pair" options={{ title: "Pair a device" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </>
  );
}
