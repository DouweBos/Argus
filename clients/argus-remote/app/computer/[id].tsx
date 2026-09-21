import { useCallback, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { ConnectionBadge } from "../../src/components/ConnectionBadge";
import {
  Badge,
  Body,
  Btn,
  Field,
  Muted,
  Row,
  Screen,
  TextField,
} from "../../src/components/ui";
import {
  endpointKindLabel,
  gatewayHost,
  hostLabel,
  identityEndpoints,
} from "../../src/lib/keystore";
import { useAppStore } from "../../src/stores/appStore";

/** One paired computer: what it granted this phone, and how to leave it. */
export default function ComputerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useAppStore((s) => s.hosts.find((h) => h.deviceId === id));
  const activeHostId = useAppStore((s) => s.activeHostId);
  const connection = useAppStore((s) => s.connection);
  const selectHost = useAppStore((s) => s.selectHost);
  const renameHost = useAppStore((s) => s.renameHost);
  const unpairHost = useAppStore((s) => s.unpairHost);

  const label = host ? hostLabel(host) : "Computer";
  const [name, setName] = useState(label);
  const [saved, setSaved] = useState(false);
  const [syncedLabel, setSyncedLabel] = useState(label);

  if (label !== syncedLabel) {
    setSyncedLabel(label);
    setName(label);
  }

  const save = useCallback(() => {
    if (!host) {
      return;
    }
    renameHost(host.deviceId, name).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }, [host, name, renameHost]);

  const confirmUnpair = useCallback(() => {
    if (!host) {
      return;
    }
    Alert.alert(
      `Unpair “${label}”?`,
      "This phone loses access until you pair with that computer again. Revoke it in Argus too if the phone was lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unpair",
          style: "destructive",
          onPress: () => {
            unpairHost(host.deviceId)
              .catch(() => {})
              .finally(() => router.dismissTo("/"));
          },
        },
      ],
    );
  }, [host, label, router, unpairHost]);

  if (!host) {
    return (
      <Screen>
        <Muted>This computer is no longer paired.</Muted>
        <Btn label="Back" tone="secondary" onPress={() => router.dismissTo("/")} />
      </Screen>
    );
  }

  const active = host.deviceId === activeHostId;
  const endpoints = identityEndpoints(host);

  return (
    <Screen>
      <Stack.Screen options={{ title: label }} />

      <Field label="Connection">
        <Row gap={8}>
          {active ? <ConnectionBadge state={connection} /> : <Badge label="Not connected" />}
          <Muted>Can: {host.capabilities.join(", ")}</Muted>
        </Row>
        {!active && (
          <Btn
            label="Connect and open projects"
            onPress={() => {
              selectHost(host.deviceId)
                .catch(() => {})
                .finally(() => router.replace("/projects"));
            }}
          />
        )}
      </Field>

      <Field label="Name" caption="Only shown on this phone.">
        <TextField
          value={name}
          maxLength={60}
          placeholder="Computer name"
          onChangeText={setName}
          onSubmitEditing={save}
        />
        <Btn
          label={saved ? "Saved" : "Save"}
          size="sm"
          tone="secondary"
          disabled={name.trim() === label || name.trim().length === 0}
          onPress={save}
        />
      </Field>

      <Field
        label="Addresses"
        caption="Every route this computer advertised. All are dialled at once and the simplest one that answers wins."
      >
        {endpoints.map((endpoint) => (
          <Row key={endpoint.url} gap={8}>
            <Body style={{ flex: 1 }}>{gatewayHost(endpoint.url)}</Body>
            {endpoint.url === host.url && active && connection === "ready" ? (
              <Badge label="In use" tone="success" />
            ) : null}
            <Badge label={endpointKindLabel(endpoint.kind)} />
          </Row>
        ))}
      </Field>

      <Field label="Gateway">
        <Muted>Device {host.deviceId.slice(0, 8)}</Muted>
        {host.pairedAt ? (
          <Muted>Paired {new Date(host.pairedAt).toLocaleDateString()}</Muted>
        ) : null}
      </Field>

      <Field
        label="Unpair"
        caption="Removes this computer's key from the phone. Nothing on the computer changes — revoke the device there to cut it off for good."
      >
        <Btn label="Unpair this computer" tone="danger" onPress={confirmUnpair} />
      </Field>
    </Screen>
  );
}
