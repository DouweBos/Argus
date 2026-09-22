import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AppleTVRemote, type TvRemoteButton } from "./AppleTVRemote";

const meta: Meta<typeof AppleTVRemote> = {
  title: "Components/AppleTVRemote",
  component: AppleTVRemote,
  parameters: { layout: "centered" },
};

export default meta;

type Story = StoryObj<typeof AppleTVRemote>;

function Demo({ blocked }: { blocked?: boolean }) {
  const [last, setLast] = useState<TvRemoteButton | null>(null);

  return (
    <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
      <AppleTVRemote blocked={blocked} onPress={setLast} />
      <p style={{ font: "var(--type-caption)", color: "var(--text-muted)" }}>
        Last press: {last ?? "—"}
      </p>
    </div>
  );
}

/** Click a quadrant of the pad for a direction, the middle for Select. */
export const Default: Story = { render: () => <Demo /> };

/** Another client holds the device — presses are refused, so it dims. */
export const Blocked: Story = { render: () => <Demo blocked /> };
