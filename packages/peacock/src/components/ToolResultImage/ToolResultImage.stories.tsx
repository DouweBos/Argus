import type { Meta, StoryObj } from "@storybook/react";
import { ToolResultImage } from "./ToolResultImage";

const meta: Meta<typeof ToolResultImage> = {
  title: "Chat/ToolResultImage",
  component: ToolResultImage,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ToolResultImage>;

const SAMPLE =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#4f46e5"/><text x="50%" y="50%" fill="white" text-anchor="middle" font-family="sans-serif">screenshot</text></svg>',
  );

export const Default: Story = {
  args: { src: SAMPLE, alt: "screenshot" },
};
