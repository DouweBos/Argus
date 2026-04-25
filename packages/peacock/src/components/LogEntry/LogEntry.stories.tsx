import type { Meta, StoryObj } from "@storybook/react";
import { LogEntry } from "./LogEntry";

const meta: Meta<typeof LogEntry> = {
  title: "Primitives/LogEntry",
  component: LogEntry,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof LogEntry>;

const NOW = new Date("2026-04-25T11:17:39.566Z").toISOString();

const STACK = `  at anonymous (<bundle>:1197:46)
  at anonymous (<bundle>:82945:35)
  at consoleReporter (<bundle>:169683:22)
  at anonymous (<bundle>:169612:41)
  at _logMessage (<bundle>:169611:34)
  at debug (<bundle>:169528:25)
  at ?anon_0_ (<bundle>:190566:75)`;

export const Levels: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LogEntry
        timestamp={NOW}
        level="error"
        source="metro"
        message="TypeError: Cannot read properties of undefined (reading 'id')"
        stackTrace={STACK}
      />
      <LogEntry
        timestamp={NOW}
        level="warning"
        source="metro"
        message="Slow network request: /library/metadata/38170 took 4821ms"
      />
      <LogEntry
        timestamp={NOW}
        level="info"
        source="metro"
        message="User signed in (id=38170)"
      />
      <LogEntry
        timestamp={NOW}
        level="log"
        source="device"
        message="Tapped button: Sign In"
      />
      <LogEntry
        timestamp={NOW}
        level="debug"
        source="metro"
        message="[fetchJson] GET 200 https://192.168.30.6:8080/api/items/38170 486ms"
        stackTrace={STACK}
      />
      <LogEntry
        timestamp={NOW}
        level="verbose"
        source="device"
        message="Heartbeat tick"
      />
    </div>
  ),
};

export const Expanded: Story = {
  args: {
    timestamp: NOW,
    level: "debug",
    source: "metro",
    message:
      "[fetchJson] GET 200 https://192.168.30.6:8080/api/items/38170 486ms",
    stackTrace: STACK,
    defaultExpanded: true,
  },
};
