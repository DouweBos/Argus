import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import * as Icons from "../../icons/Icons";
import { RuntimePicker } from "./RuntimePicker";

const meta: Meta<typeof RuntimePicker> = {
  title: "Composites/RuntimePicker",
  component: RuntimePicker,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof RuntimePicker>;

export const Default: Story = {
  render: () => {
    const [pick, setPick] = useState<string>("ipad");

    const sections = [
      {
        header: "iOS Simulators",
        items: [
          {
            id: "ipad",
            label: "Plex iPad Pro 13-inch (M5)",
            trailing: "booted",
            selected: pick === "ipad",
            onSelect: () => setPick("ipad"),
          },
          {
            id: "iphone17",
            label: "Plex iPhone 17 Pro",
            trailing: "booted",
            selected: pick === "iphone17",
            onSelect: () => setPick("iphone17"),
          },
          {
            id: "iphone16",
            label: "Plex iPhone 16 Pro",
            selected: pick === "iphone16",
            onSelect: () => setPick("iphone16"),
          },
        ],
      },
      {
        header: "Web",
        items: [
          {
            id: "chromium",
            label: "Chromium",
            selected: pick === "chromium",
            onSelect: () => setPick("chromium"),
          },
        ],
      },
    ];

    return (
      <div style={{ padding: 32 }}>
        <RuntimePicker
          icon={<Icons.SimulatorIcon size={10} />}
          label="Plex iPad Pro 13-inch (M5)"
          sections={sections}
        />
      </div>
    );
  },
};

export const NothingPicked: Story = {
  render: () => (
    <div style={{ padding: 32 }}>
      <RuntimePicker
        muted
        icon={<Icons.SimulatorIcon size={10} />}
        label="Pick device"
        sections={[]}
      />
    </div>
  ),
};
