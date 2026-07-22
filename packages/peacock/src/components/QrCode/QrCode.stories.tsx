import type { Meta, StoryObj } from "@storybook/react";
import { QrCode } from "./QrCode";

const meta = {
  title: "Components/QrCode",
  component: QrCode,
  parameters: { layout: "centered" },
} satisfies Meta<typeof QrCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: "https://argus.houwert.dev/pair?demo=1", size: 200 },
};

export const Small: Story = {
  args: { value: "argus-pairing-code-example", size: 120 },
};

export const LongPayload: Story = {
  args: {
    value: JSON.stringify({
      v: 1,
      relay_url: "wss://relay.example.com",
      pairing_id: "a1b2c3d4e5f6",
      ds_pub: "base64url-encoded-32-byte-public-key-goes-here-abc",
      pairing_secret: "base64url-encoded-32-byte-secret-goes-here-defg",
    }),
    size: 240,
  },
};
