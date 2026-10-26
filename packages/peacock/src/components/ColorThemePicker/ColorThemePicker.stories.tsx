import type { ColorThemeId } from "../../lib/colorThemes";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ColorThemePicker } from "./ColorThemePicker";

const meta: Meta<typeof ColorThemePicker> = {
  title: "Primitives/ColorThemePicker",
  component: ColorThemePicker,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ColorThemePicker>;

function Interactive({ initial }: { initial: ColorThemeId }) {
  const [value, setValue] = useState<ColorThemeId>(initial);

  return (
    <div style={{ maxWidth: 360 }}>
      <ColorThemePicker value={value} onChange={setValue} />
    </div>
  );
}

export const Default: Story = {
  render: () => <Interactive initial="amber" />,
};

export const OceanSelected: Story = {
  render: () => <Interactive initial="ocean" />,
};
