import { useEffect, useState } from "react";
import { SegmentedControl, SettingsScreenField } from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";

type WarmAgents = "0" | "1" | "2";

const OPTIONS: { label: string; value: WarmAgents }[] = [
  { label: "Off", value: "0" },
  { label: "1", value: "1" },
  { label: "2", value: "2" },
];

/**
 * How many agents the host keeps warmed up for the sessions you're looking at.
 * Host state: the host does the warming, for every client.
 */
export function WarmAgentsSetting() {
  const [value, setValue] = useState<WarmAgents>("1");

  useEffect(() => {
    let cancelled = false;
    getAppSettings()
      .then((settings) => {
        if (!cancelled && settings.warm_agents !== undefined) {
          setValue(String(settings.warm_agents) as WarmAgents);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const change = (next: WarmAgents) => {
    const previous = value;
    setValue(next);
    setAppSettings({ warm_agents: Number(next) }).catch(() => {
      setValue(previous);
    });
  };

  return (
    <SettingsScreenField
      label="Warm agents"
      caption="Agents kept started for the sessions you're looking at, so a new one is ready at once. Each is a running Claude Code process with its MCP servers."
    >
      <SegmentedControl
        aria-label="Warm agents"
        options={OPTIONS}
        value={value}
        onChange={change}
      />
    </SettingsScreenField>
  );
}
