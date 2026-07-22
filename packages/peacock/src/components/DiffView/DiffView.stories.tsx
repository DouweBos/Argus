import type { Meta, StoryObj } from "@storybook/react";
import { DiffView } from "./DiffView";

const meta: Meta<typeof DiffView> = {
  title: "Chat/DiffView",
  component: DiffView,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof DiffView>;

export const Edit: Story = {
  args: {
    oldString: "const a = 1;\nconst b = 2;\nreturn a + b;",
    newString: "const a = 1;\nconst b = 20;\nreturn a + b;",
  },
};

export const Write: Story = {
  args: {
    newString: "export function hello() {\n  return 'hi';\n}",
  },
};

export const Collapsible: Story = {
  args: {
    newString: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
  },
};
