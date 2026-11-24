import type {
  TeammateAvatar as TeammateLook,
  TeammateColor,
} from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  TEAMMATE_COLORS,
  TEAMMATE_SYMBOLS,
  TeammateAvatar,
} from "./TeammateAvatar";
import { TeammateLookPicker } from "./TeammateLookPicker";

const meta: Meta<typeof TeammateAvatar> = {
  title: "Primitives/TeammateAvatar",
  component: TeammateAvatar,
  tags: ["autodocs"],
  args: {
    name: "CI Fixer",
    color: "orange",
    avatar: { kind: "symbol", symbol: "wrench" },
    size: 40,
  },
};
export default meta;
type Story = StoryObj<typeof TeammateAvatar>;

export const WithSymbol: Story = {};

export const Initials: Story = {
  args: {
    name: "Release Notes Writer",
    color: "teal",
    avatar: { kind: "initials" },
  },
};

const grid = { display: "flex", flexWrap: "wrap", gap: 12 } as const;

export const EveryColour: Story = {
  render: () => (
    <div style={grid}>
      {TEAMMATE_COLORS.map((color) => (
        <TeammateAvatar
          avatar={{ kind: "initials" }}
          color={color}
          key={color}
          name={`${color} teammate`}
          size={36}
        />
      ))}
    </div>
  ),
};

export const EverySymbol: Story = {
  render: () => (
    <div style={grid}>
      {TEAMMATE_SYMBOLS.map((symbol, i) => (
        <TeammateAvatar
          avatar={{ kind: "symbol", symbol }}
          color={TEAMMATE_COLORS[i % TEAMMATE_COLORS.length]}
          key={symbol}
          name={symbol}
          size={36}
        />
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ ...grid, alignItems: "center" }}>
      {[20, 28, 34, 44, 64].map((size) => (
        <TeammateAvatar {...args} key={size} size={size} />
      ))}
    </div>
  ),
};

function PickerDemo() {
  const [look, setLook] = useState<{
    color: TeammateColor;
    avatar: TeammateLook;
  }>({ color: "purple", avatar: { kind: "symbol", symbol: "eye" } });

  return <TeammateLookPicker name="PR Reviewer" {...look} onChange={setLook} />;
}

export const LookPicker: Story = { render: () => <PickerDemo /> };
