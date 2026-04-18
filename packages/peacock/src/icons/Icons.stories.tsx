import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import * as Icons from "./Icons";

const meta: Meta = {
  title: "Foundations/Icons",
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj;

const entries = Object.entries(Icons).filter(
  ([, v]) => typeof v === "function",
) as [string, (props: { size?: number }) => ReactElement][];

export const All: Story = {
  render: () => (
    <div
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 12,
      }}
    >
      {entries.map(([name, Icon]) => (
        <div
          key={name}
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            background: "var(--glass-bg)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            color: "var(--text-secondary)",
            minHeight: 80,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <Icon size={name === "ArgusLogo" ? 32 : 16} />
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-muted)",
            }}
          >
            {name}
          </div>
        </div>
      ))}
    </div>
  ),
};
