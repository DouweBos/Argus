import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  ColorSchemePicker,
  type ColorSchemePreference,
} from "./ColorSchemePicker";

const meta: Meta<typeof ColorSchemePicker> = {
  title: "Primitives/ColorSchemePicker",
  component: ColorSchemePicker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "System, Light and Dark as small window previews, as the Mac's `ColorSchemeCards`. Each preview keeps its scheme whichever one is showing; the dot takes the colour theme's accent.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ColorSchemePicker>;

function Interactive({ initial }: { initial: ColorSchemePreference }) {
  const [value, setValue] = useState(initial);

  return (
    <div style={{ maxWidth: 360 }}>
      <ColorSchemePicker value={value} onChange={setValue} />
    </div>
  );
}

export const System: Story = { render: () => <Interactive initial="system" /> };

export const Light: Story = { render: () => <Interactive initial="light" /> };

export const Dark: Story = { render: () => <Interactive initial="dark" /> };
