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
import { hostLabel } from "../src/lib/keystore";
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
import { useAppStore, type PushState } from "../src/stores/appStore";

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = (
  ["system", "light", "dark"] as const
).map((value) => ({ value, label: THEME_PREFERENCE_LABELS[value] }));

const NOTIFY_LABEL: Record<string, string> = {
  granted: "Enabled",
  blocked: "Blocked — enable in system settings",
  unset: "Not enabled",
};

const PUSH_OPTIONS: { label: string; value: "off" | "on" }[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const PUSH_LABEL: Record<PushState, string> = {
  registered: "Registered — your computer can wake this phone.",
  conflict:
    "A previous install of this app still holds this device's push slot. It clears itself within 90 days, or unpair and pair again.",
  unconfigured:
    "Registered, but Argus on your computer has no Apple/Firebase push credentials yet.",
  unavailable:
    "Unavailable on this build — needs notification permission and a real device.",
  unsupported:
    "The computer you're connected to is running an older Argus. Update it to enable background push.",
  off: "Off — you'll only see alerts while the app is connected.",
};

export default function SettingsScreen() {
  const router = useRouter();
  const identity = useAppStore((s) => s.identity);
  const hosts = useAppStore((s) => s.hosts);
  const deviceName = useAppStore((s) => s.deviceName);
  const setDeviceName = useAppStore((s) => s.setDeviceName);
  const connection = useAppStore((s) => s.connection);
  const capabilities = useAppStore((s) => s.capabilities);
  const pushEnabled = useAppStore((s) => s.pushEnabled);
  const pushState = useAppStore((s) => s.pushState);
  const setPushEnabled = useAppStore((s) => s.setPushEnabled);
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
      // Permission is what gates the push token, so re-register right after.
      .then(() => setPushEnabled(true))
      .then(() => notificationStatus())
      .then(setNotify)
      .catch(() => {});
  }, [setPushEnabled]);

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
        caption="Shown under paired devices in Argus on every computer you pair with."
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

      <Field
        label="Background push"
        caption="Wakes this phone even when the app is closed. Your computer sends these directly to Apple/Google — no Argus server in between."
      >
        <SegmentedControl<"off" | "on">
          value={pushEnabled ? "on" : "off"}
          options={PUSH_OPTIONS}
          onChange={(v) => {
            setPushEnabled(v === "on").catch(() => {});
          }}
        />
        <Muted>{PUSH_LABEL[pushState]}</Muted>
      </Field>

      <Field
        label="Computers"
        caption="Pair with as many computers as you like; the app talks to one at a time. Manage or unpair them from the home screen."
      >
        {identity ? (
          <Body>
            Connected to {hostLabel(identity)}
            {hosts.length > 1 ? ` — ${hosts.length} paired` : ""}
          </Body>
        ) : (
          <Muted>
            {hosts.length === 0
              ? "No computers paired yet."
              : `${hosts.length} paired, none connected.`}
          </Muted>
        )}
        <Btn
          label={hosts.length === 0 ? "Pair a computer" : "Manage computers"}
          tone="secondary"
          onPress={() =>
            hosts.length === 0 ? router.push("/pair") : router.dismissTo("/")
          }
        />
      </Field>
    </Screen>
  );
}
