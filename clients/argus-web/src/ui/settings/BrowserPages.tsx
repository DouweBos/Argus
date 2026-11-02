/**
 * This browser's settings pages, as the phone's `SettingsPages`: its name,
 * appearance, alerts and privacy. All local; nothing here asks the computer
 * except the name it is listed under.
 */

import { useState } from "react";
import {
  Button,
  ColorSchemePicker,
  ColorThemePicker,
  Input,
  SegmentedControl,
  SettingsScreenField,
} from "@argus/peacock";
import {
  notificationsSupported,
  requestNotificationPermission,
} from "../../lib/notify";
import {
  setColorTheme,
  setThemePreference,
  useColorTheme,
  useThemePreference,
} from "../../lib/theme";
import { webPushSupported, type WebPushState } from "../../lib/webpush";
import { useConnectionStore } from "../../stores/connection";
import { usePushStore } from "../../stores/push";
import { capture, telemetryConfigured } from "../../telemetry/telemetry";
import { accountFields } from "../accountFields";
import { PrivacyField } from "../TelemetryConsent";

export function NamePage() {
  const deviceName = useConnectionStore((s) => s.deviceName);
  const setDeviceName = useConnectionStore((s) => s.setDeviceName);
  const account = useConnectionStore((s) => s.identity?.account);
  const [name, setName] = useState(deviceName);
  const [saved, setSaved] = useState(false);
  const fields = accountFields();

  if (account && fields) {
    // An account device is named on the account.
    return (
      <div className="aw-settings">
        <fields.Name />
      </div>
    );
  }
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
    </div>
  );
}

export function AppearancePage() {
  const scheme = useThemePreference();
  const colorTheme = useColorTheme();

  return (
    <div className="aw-settings">
      <SettingsScreenField
        label="Colour scheme"
        caption="Match your system, or keep this browser light or dark."
      >
        <ColorSchemePicker
          value={scheme}
          onChange={(next) => {
            setThemePreference(next);
            capture("web_appearance_changed", { appearance: next });
          }}
        />
      </SettingsScreenField>
      <SettingsScreenField
        label="Colour theme"
        caption="The accent used for buttons, links and selection."
      >
        <ColorThemePicker
          value={colorTheme}
          onChange={(next) => {
            setColorTheme(next);
            capture("web_color_theme_changed", { theme: next });
          }}
        />
      </SettingsScreenField>
    </div>
  );
}

function notificationStatusLabel(): string {
  if (!notificationsSupported()) {
    return "Not supported in this browser";
  }
  if (Notification.permission === "granted") {
    return "On";
  }
  if (Notification.permission === "denied") {
    return "Blocked — allow notifications in the browser's site settings";
  }

  return "Not enabled";
}

const PUSH_OPTIONS: { label: string; value: "off" | "on" }[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const PUSH_LABEL: Record<WebPushState, string> = {
  registered:
    "Registered — your computer can reach this browser with every tab closed.",
  unconfigured:
    "Background push is switched off in Argus on your computer (Settings → Remote access).",
  unavailable:
    "Unavailable here — background push needs notification permission and an https address.",
  off: "Off — you'll only see alerts while this tab is open.",
};

export function AlertsPage() {
  const pushEnabled = usePushStore((s) => s.pushEnabled);
  const pushState = usePushStore((s) => s.pushState);
  const setPushEnabled = usePushStore((s) => s.setPushEnabled);
  const account = useConnectionStore((s) => s.identity?.account);
  const [status, setStatus] = useState(notificationStatusLabel());
  const enable = () => {
    requestNotificationPermission()
      // Permission is what gates the push subscription, so retry it right after.
      .then(() => setPushEnabled(pushEnabled))
      .finally(() => setStatus(notificationStatusLabel()));
  };

  return (
    <div className="aw-settings">
      <SettingsScreenField
        label="Notifications"
        caption="Get alerted when an agent finishes or needs approval, even when you're on another screen."
      >
        <div className="aw-settings-inline">
          <span className="aw-muted">{status}</span>
          <Button
            variant="secondary"
            disabled={
              !notificationsSupported() ||
              Notification.permission === "granted" ||
              Notification.permission === "denied"
            }
            onClick={enable}
          >
            Enable
          </Button>
        </div>
      </SettingsScreenField>

      {/* Push is off in the hosted app: one origin serves every computer. */}
      {!account && (
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
      )}
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="aw-settings">
      {telemetryConfigured() ? (
        <PrivacyField />
      ) : (
        <SettingsScreenField
          label="Usage data"
          caption="This build of Argus has no analytics key, so it sends nothing at all."
        />
      )}
    </div>
  );
}
