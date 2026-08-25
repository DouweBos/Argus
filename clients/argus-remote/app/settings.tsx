import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  Badge,
  Body,
  Btn,
  Field,
  Muted,
  Row,
  Screen,
  SegmentedControl,
  TextField,
} from "../src/components/ui";
import {
  notificationStatus,
  requestNotificationPermission,
} from "../src/lib/notify";
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  useThemePreference,
  type ThemePreference,
} from "../src/theme";
import { useAppStore } from "../src/stores/appStore";

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = (
  ["system", "light", "dark"] as const
).map((value) => ({ value, label: THEME_PREFERENCE_LABELS[value] }));

const NOTIFY_LABEL: Record<string, string> = {
  granted: "Enabled",
  blocked: "Blocked — enable in system settings",
  unset: "Not enabled",
};

export default function SettingsScreen() {
  const router = useRouter();
  const identity = useAppStore((s) => s.identity);
  const deviceName = useAppStore((s) => s.deviceName);
  const setDeviceName = useAppStore((s) => s.setDeviceName);
  const connection = useAppStore((s) => s.connection);
  const capabilities = useAppStore((s) => s.capabilities);
  const unpair = useAppStore((s) => s.unpair);
  const theme = useThemePreference();

  const [name, setName] = useState(deviceName);
  const [saved, setSaved] = useState(false);
  const [notify, setNotify] = useState<string>("unset");

  useEffect(() => setName(deviceName), [deviceName]);
  useEffect(() => {
    notificationStatus()
      .then(setNotify)
      .catch(() => {});
  }, []);

  const dirty = name.trim() !== deviceName && name.trim().length > 0;
  const save = useCallback(() => {
    setDeviceName(name).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }, [name, setDeviceName]);

  const enableNotifications = useCallback(() => {
    requestNotificationPermission()
      .then(() => notificationStatus())
      .then(setNotify)
      .catch(() => {});
  }, []);

  return (
    <Screen>
      <Field label="Connection">
        <Row gap={8}>
          <Badge
            label={connection}
            tone={connection === "ready" ? "success" : "warning"}
          />
          {capabilities.length > 0 ? (
            <Muted>Can: {capabilities.join(", ")}</Muted>
          ) : null}
        </Row>
      </Field>

      <Field
        label="Device name"
        caption="Shown in Argus on your computer under paired devices."
      >
        <TextField
          value={name}
          maxLength={60}
          placeholder="Device name"
          onChangeText={setName}
          onSubmitEditing={save}
        />
        <Btn
          label={saved ? "Saved" : "Save"}
          size="sm"
          tone="secondary"
          disabled={!dirty}
          onPress={save}
        />
      </Field>

      <Field label="Appearance" caption="Match your system, or force light or dark.">
        <SegmentedControl<ThemePreference>
          value={theme}
          options={THEME_OPTIONS}
          onChange={setThemePreference}
        />
      </Field>

      <Field
        label="Notifications"
        caption="Get alerted when an agent finishes or needs approval."
      >
        <Muted>{NOTIFY_LABEL[notify]}</Muted>
        <Btn
          label="Enable"
          size="sm"
          tone="secondary"
          disabled={notify !== "unset"}
          onPress={enableNotifications}
        />
      </Field>

      {identity ? (
        <Field
          label="Paired device"
          caption="Removes the stored key from this phone. You'll need to pair again from Argus to reconnect."
        >
          <Body>{identity.deviceId.slice(0, 8)}</Body>
          <Muted>Gateway: {identity.url}</Muted>
          <Btn
            label="Unpair this device"
            tone="danger"
            onPress={() => {
              unpair()
                .catch(() => {})
                .finally(() => router.replace("/"));
            }}
          />
        </Field>
      ) : (
        <Btn label="Pair a device" onPress={() => router.push("/pair")} />
      )}
    </Screen>
  );
}
