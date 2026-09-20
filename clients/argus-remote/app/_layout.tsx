// MUST be first: Hermes has no crypto.getRandomValues; noble needs it.
import "react-native-get-random-values";

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import {
  Stack,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ImageViewer } from "../src/components/ImageViewer";
import { LockScreen } from "../src/components/LockScreen";
import {
  registerNotificationCategories,
  setNotificationDecider,
  setNotificationOpener,
  startNotificationRouting,
} from "../src/lib/notify";
import { startSealedPushHandling } from "../src/lib/pushBackground";
import { useThemeBootstrap, useTheme } from "../src/theme";
import { useAppStore } from "../src/stores/appStore";

/** What the unlock button should promise — Face ID, Touch ID, or nothing. */
async function describeBiometry(): Promise<string | null> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const { AuthenticationType } = LocalAuthentication;
  if (types.includes(AuthenticationType.FACIAL_RECOGNITION)) {
    return Platform.OS === "ios" ? "Face ID" : "Face Unlock";
  }
  if (types.includes(AuthenticationType.FINGERPRINT)) {
    return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
  }

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const theme = useTheme();
  const router = useRouter();
  const init = useAppStore((s) => s.init);
  const [unlocked, setUnlocked] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState<string | null>(null);
  // A notification tap can land before the gate is passed, and the navigator
  // only exists once it is — so hold the jump and replay it after unlock.
  const unlockedRef = useRef(false);
  const pendingOpen = useRef<{ agentId: string; label: string } | null>(null);

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
      setBiometryLabel(await describeBiometry());
      setNeedsAuth(true);
    })();
  }, [init]);

  // Which agent is on screen right now, so a notification for it doesn't stack
  // a second copy of the same screen.
  const pathname = usePathname();
  const { id } = useGlobalSearchParams<{ id?: string }>();
  const openAgentRef = useRef<string | null>(null);

  useEffect(() => {
    openAgentRef.current = pathname.startsWith("/agent/") ? (id ?? null) : null;
  }, [pathname, id]);

  const openAgent = useCallback(
    (agentId: string, label: string) => {
      if (openAgentRef.current === agentId) {
        return;
      }
      // The alert may be from a computer we're not currently connected to —
      // switch to the one that owns the agent before opening it.
      const store = useAppStore.getState();
      store
        .hostForAgent(agentId)
        .then((hostId) =>
          hostId && hostId !== store.activeHostId
            ? store.selectHost(hostId)
            : undefined,
        )
        .catch(() => {})
        .finally(() => {
          router.push({
            pathname: "/agent/[id]",
            params: { id: agentId, label },
          });
        });
    },
    [router],
  );

  // Replays a tap that arrived while locked, once the navigator is mounted.
  useEffect(() => {
    unlockedRef.current = unlocked;
    const pending = pendingOpen.current;
    if (!unlocked || !pending) {
      return;
    }
    pendingOpen.current = null;
    openAgent(pending.agentId, pending.label);
  }, [unlocked, openAgent]);

  // Tapping a notification jumps to the agent it came from; its Approve/Deny
  // buttons answer the prompt without opening the app at all. Registered
  // outside the biometric gate so a background tap is never dropped — the
  // answer is queued and sent once the gateway is back.
  useEffect(() => {
    registerNotificationCategories().catch(() => {});
    startSealedPushHandling().catch(() => {});
    setNotificationOpener((agentId, label) => {
      if (!unlockedRef.current) {
        pendingOpen.current = { agentId, label };

        return;
      }
      openAgent(agentId, label);
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
  }, [openAgent]);

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
      <LockScreen
        canAuthenticate={needsAuth}
        biometryLabel={biometryLabel}
        onUnlock={authenticate}
      />
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
        <Stack.Screen name="index" options={{ title: "Argus" }} />
        <Stack.Screen name="projects" options={{ title: "Projects" }} />
        <Stack.Screen name="computer/[id]" options={{ title: "Computer" }} />
        <Stack.Screen name="pair" options={{ title: "Pair a computer" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="devices" options={{ title: "Devices" }} />
      </Stack>
      <ImageViewer />
    </>
  );
}
