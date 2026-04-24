import type { Meta, StoryObj } from "@storybook/react";
import { ImageAttachmentStrip } from "./ImageAttachmentStrip";

const meta: Meta<typeof ImageAttachmentStrip> = {
  title: "Primitives/ImageAttachmentStrip",
  component: ImageAttachmentStrip,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ImageAttachmentStrip>;

const sampleItems = [
  {
    name: "screenshot-1.png",
    previewUrl:
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=96&h=96&fit=crop",
  },
  {
    name: "screenshot-2.png",
    previewUrl:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=96&h=96&fit=crop",
  },
  {
    name: "diagram.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=96&h=96&fit=crop",
  },
];

export const Default: Story = {
  args: {
    items: sampleItems,
    onRemove: () => {},
    onPreview: () => {},
  },
};

export const Single: Story = {
  args: {
    items: [sampleItems[0]],
    onRemove: () => {},
  },
};

export const Scrolling: Story = {
  args: {
    items: [...sampleItems, ...sampleItems, ...sampleItems],
    scroll: true,
    onRemove: () => {},
    onPreview: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 240 }}>
        <Story />
      </div>
    ),
  ],
};
