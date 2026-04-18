import type { Meta, StoryObj } from "@storybook/react";
import { Input, TextArea } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: "Search files…" },
  render: (args) => <div style={{ width: 280 }}><Input {...args} /></div>,
};

export const Mono: Story = {
  args: { mono: true, placeholder: "branch/name" },
  render: (args) => <div style={{ width: 280 }}><Input {...args} /></div>,
};

export const Textarea: StoryObj<typeof TextArea> = {
  render: () => (
    <div style={{ width: 380 }}>
      <TextArea placeholder="Refactor the workspace card to use the new…" />
    </div>
  ),
};
