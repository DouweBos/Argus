import { useState } from "react";
import {
  Button,
  Input,
  SegmentedControl,
  SettingsScreenField,
} from "@argus/peacock";
import {
  notificationsSupported,
  requestNotificationPermission,
} from "../lib/notify";
import { useAppStore } from "../lib/store";
import { webPushSupported, type WebPushState } from "../lib/webpush";
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  type ThemePreference,
  useThemePreference,
} from "../lib/theme";

function notificationStatusLabel(): string {
  if (!notificationsSupported()) {
    return "Not supported in this browser";
  }
  if (Notification.permission === "granted") {
    return "Enabled";
  }
  if (Notification.permission === "denied") {
    return "Blocked — enable in browser settings";
  }

  return "Not enabled";
}

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = (
  ["system", "light", "dark"] as const
).map((value) => ({ value, label: THEME_PREFERENCE_LABELS[value] }));

const PUSH_OPTIONS: { label: string; value: "off" | "on" }[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const PUSH_LABEL: Record<WebPushState, string> = {
  registered: "Registered — your computer can reach this browser with every tab closed.",
  unconfigured:
    "Background push is switched off in Argus on your computer (Settings → Remote access).",
  unavailable:
    "Unavailable here — background push needs notification permission and an https address.",
  off: "Off — you'll only see alerts while this tab is open.",
};

export function Settings() {
  const deviceName = useAppStore((s) => s.deviceName);
  const setDeviceName = useAppStore((s) => s.setDeviceName);
  const unpair = useAppStore((s) => s.unpair);
  const pushEnabled = useAppStore((s) => s.pushEnabled);
  const pushState = useAppStore((s) => s.pushState);
  const setPushEnabled = useAppStore((s) => s.setPushEnabled);
  const theme = useThemePreference();

  const [name, setName] = useState(deviceName);
  const [saved, setSaved] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState(notificationStatusLabel());
  const enableNotifications = () => {
    requestNotificationPermission()
      // Permission is what gates the push subscription, so retry it right after.
      .then(() => setPushEnabled(pushEnabled))
      .finally(() => setNotifyStatus(notificationStatusLabel()));
  };

  const dirty = name.trim() !== deviceName && name.trim().length > 0;
  const save = () => {
    setDeviceName(name).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="aw-settings">
      <SettingsScreenField
        label="Device name"
        caption="Shown in Argus on your computer under paired devices."
      >
        <div className="aw-settings-inline">
          <Input
            value={name}
            maxLength={60}
            placeholder="Device name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) {
                save();
              }
            }}
          />
          <Button variant="secondary" disabled={!dirty} onClick={save}>
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </SettingsScreenField>

      <SettingsScreenField
        label="Appearance"
        caption="Match your system, or force light or dark."
      >
        <SegmentedControl<ThemePreference>
          aria-label="Theme"
          value={theme}
          options={THEME_OPTIONS}
          onChange={setThemePreference}
        />
      </SettingsScreenField>

      <SettingsScreenField
        label="Notifications"
        caption="Get alerted when an agent finishes or needs approval, even when you're on another screen."
      >
        <div className="aw-settings-inline">
          <span className="aw-muted">{notifyStatus}</span>
          <Button
            variant="secondary"
            disabled={
              !notificationsSupported() ||
              Notification.permission === "granted" ||
              Notification.permission === "denied"
            }
            onClick={enableNotifications}
          >
            Enable
          </Button>
        </div>
      </SettingsScreenField>

      <SettingsScreenField
        label="Background push"
        caption="Keep getting alerts after you close every Argus tab. Your computer encrypts and sends these itself — no Argus server sees them."
      >
        <SegmentedControl<"off" | "on">
          aria-label="Background push"
          value={pushEnabled ? "on" : "off"}
          options={PUSH_OPTIONS}
          onChange={(v) => {
            setPushEnabled(v === "on").catch(() => {});
          }}
        />
        <span className="aw-muted">
          {webPushSupported()
            ? PUSH_LABEL[pushState]
            : PUSH_LABEL.unavailable}
        </span>
      </SettingsScreenField>

      <SettingsScreenField
        label="Unpair this device"
        caption="Removes the stored key from this browser. You'll need to pair again from Argus to reconnect."
      >
        <Button variant="danger" onClick={unpair}>
          Unpair
        </Button>
      </SettingsScreenField>
    </div>
  );
}