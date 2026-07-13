import { useState } from "react";
import {
  Button,
  Input,
  SegmentedControl,
  SettingsScreenField,
} from "@argus/peacock";
import { useAppStore } from "../lib/store";
import {
  setThemePreference,
  THEME_PREFERENCE_LABELS,
  type ThemePreference,
  useThemePreference,
} from "../lib/theme";

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = (
  ["system", "light", "dark"] as const
).map((value) => ({ value, label: THEME_PREFERENCE_LABELS[value] }));

export function Settings() {
  const deviceName = useAppStore((s) => s.deviceName);
  const setDeviceName = useAppStore((s) => s.setDeviceName);
  const unpair = useAppStore((s) => s.unpair);
  const theme = useThemePreference();

  const [name, setName] = useState(deviceName);
  const [saved, setSaved] = useState(false);

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