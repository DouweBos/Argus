import { useCallback, useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";
import { ConnectionBadge } from "../src/components/ConnectionBadge";
import * as Icons from "../src/components/Icons";
import {
  Badge,
  Body,
  Btn,
  Card,
  EmptyState,
  HeaderIconBtn,
  IconBtn,
  Loading,
  Muted,
  Row,
  Screen,
  SectionHeader,
} from "../src/components/ui";
import { gatewayHost, hostLabel } from "../src/lib/keystore";
import { useAppStore } from "../src/stores/appStore";
import { useTheme } from "../src/theme";

/** Only jump straight into the last computer once per launch — after that the
 *  user came back here deliberately. */
let autoOpened = false;

/**
 * Home: the computers this phone is paired with. Picking one connects to it
 * (only one at a time) and opens its projects.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const loaded = useAppStore((s) => s.loaded);
  const hosts = useAppStore((s) => s.hosts);
  const activeHostId = useAppStore((s) => s.activeHostId);
  const connection = useAppStore((s) => s.connection);
  const selectHost = useAppStore((s) => s.selectHost);
  const opening = useRef(false);

  const open = useCallback(
    (deviceId: string) => {
      if (opening.current) {
        return;
      }
      opening.current = true;
      selectHost(deviceId)
        .catch(() => {})
        .finally(() => {
          opening.current = false;
          router.push("/projects");
        });
    },
    [router, selectHost],
  );

  useEffect(() => {
    if (loaded && !autoOpened && activeHostId) {
      autoOpened = true;
      router.push("/projects");
    }
  }, [loaded, activeHostId, router]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderIconBtn
              label="Settings"
              icon={Icons.Gear}
              onPress={() => router.push("/settings")}
            />
          ),
        }}
      />

      {!loaded ? (
        <Loading label="Unlocking…" />
      ) : hosts.length === 0 ? (
        <>
          <EmptyState
            icon={<Icons.Desktop size={22} color={theme.textMuted} />}
            title="No computers paired"
            body="Pair with Argus on your Mac to drive its agents from here. Open Settings → Remote Access on the computer to get a code."
          />
          <Btn label="Pair a computer" onPress={() => router.push("/pair")} />
        </>
      ) : (
        <>
          <SectionHeader count={hosts.length}>Computers</SectionHeader>
          {hosts.map((host) => {
            const active = host.deviceId === activeHostId;

            return (
              <Card key={host.deviceId} onPress={() => open(host.deviceId)}>
                <Row gap={8}>
                  <Icons.Desktop
                    size={16}
                    color={active ? theme.accent : theme.textSecondary}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body numberOfLines={1}>{hostLabel(host)}</Body>
                    <Muted numberOfLines={1}>{gatewayHost(host.url)}</Muted>
                  </View>
                  {active ? (
                    <ConnectionBadge state={connection} />
                  ) : (
                    <Badge label="Tap to connect" />
                  )}
                  <IconBtn
                    label={`${hostLabel(host)} settings`}
                    onPress={() =>
                      router.push({
                        pathname: "/computer/[id]",
                        params: { id: host.deviceId },
                      })
                    }
                  >
                    <Icons.Ellipsis size={16} color={theme.textMuted} />
                  </IconBtn>
                </Row>
              </Card>
            );
          })}
          <Btn
            label="Pair another computer"
            tone="secondary"
            onPress={() => router.push("/pair")}
          />
        </>
      )}
    </Screen>
  );
}
