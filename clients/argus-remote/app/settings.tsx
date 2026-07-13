import { useRouter } from "expo-router";
import { Body, Btn, Card, Muted, Screen, Title } from "../src/components/ui";
import { useAppStore } from "../src/stores/appStore";

export default function SettingsScreen() {
  const router = useRouter();
  const identity = useAppStore((s) => s.identity);
  const connection = useAppStore((s) => s.connection);
  const unpair = useAppStore((s) => s.unpair);

  return (
    <Screen>
      <Title>Settings</Title>

      <Card>
        <Muted>Connection</Muted>
        <Body>{connection}</Body>
      </Card>

      {identity ? (
        <Card>
          <Muted>Paired device</Muted>
          <Body>{identity.deviceId.slice(0, 8)}</Body>
          <Muted>Gateway: {identity.url}</Muted>
          <Muted>Can: {identity.capabilities.join(", ")}</Muted>
          <Btn
            label="Unpair this device"
            tone="danger"
            onPress={async () => {
              await unpair();
              router.replace("/");
            }}
          />
        </Card>
      ) : (
        <Btn
          label="Pair a device"
          tone="primary"
          onPress={() => router.push("/pair")}
        />
      )}
    </Screen>
  );
}
