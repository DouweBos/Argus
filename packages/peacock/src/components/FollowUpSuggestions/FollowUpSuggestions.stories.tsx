import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FollowUpSuggestions } from "./FollowUpSuggestions";

const meta: Meta<typeof FollowUpSuggestions> = {
  title: "Components/FollowUpSuggestions",
  component: FollowUpSuggestions,
};

export default meta;

type Story = StoryObj<typeof FollowUpSuggestions>;

const ITEMS = ["Yes, add the tests", "Commit it", "Open a pull request"];

function Picker({ items, tabHint }: { items: string[]; tabHint?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div style={{ width: 460 }}>
      <FollowUpSuggestions
        items={items}
        tabHint={tabHint}
        onSelect={(i) => setPicked(items[i] ?? null)}
      />
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {picked ? `Filled in: ${picked}` : "Pick a suggestion"}
      </p>
    </div>
  );
}

/** What a chat input shows once a turn ends with an offer. */
export const Default: Story = {
  render: () => <Picker items={ITEMS} tabHint />,
};

/** Without the keyboard hint — a touch client has no Tab. */
export const NoTabHint: Story = {
  render: () => <Picker items={ITEMS} />,
};

export const Single: Story = {
  render: () => <Picker items={["Go ahead"]} tabHint />,
};

/** Long suggestions truncate, the full text stays in the tooltip. */
export const LongText: Story = {
  render: () => (
    <Picker
      items={[
        "Yes, migrate every remaining caller to the new API and delete the old one",
        "Only do the renderer for now",
      ]}
      tabHint
    />
  ),
};

/** Nothing to suggest renders nothing. */
export const Empty: Story = {
  render: () => <Picker items={[]} />,
};
