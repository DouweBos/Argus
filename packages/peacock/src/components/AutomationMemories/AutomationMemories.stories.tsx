import type { Meta, StoryObj } from "@storybook/react";
import { FIXTURE_MEMORIES } from "../AutomationFields/fixtures";
import { AutomationMemories } from "./AutomationMemories";
import { MemoryEditDialog } from "./MemoryEditDialog";

const meta: Meta<typeof AutomationMemories> = {
  title: "Automations/AutomationMemories",
  component: AutomationMemories,
  tags: ["autodocs"],
  args: {
    onDelete: () => undefined,
    onSave: () => Promise.resolve(),
  },
};
export default meta;
type Story = StoryObj<typeof AutomationMemories>;

export const Default: Story = { args: { memories: FIXTURE_MEMORIES } };

export const Empty: Story = { args: { memories: [] } };

export const TeammateEmpty: Story = {
  args: {
    memories: [],
    emptyText:
      "Nothing yet. Tell it to remember something, or let its duties save what they learn.",
    footer: "Plain markdown files on this computer; up to 100.",
  },
};

export const Loading: Story = { args: { memories: null } };

export const ReadOnly: Story = {
  args: { memories: FIXTURE_MEMORIES, onDelete: undefined, onSave: undefined },
};

export const Failed: Story = {
  args: { memories: null, error: "Couldn't read this automation's memories." },
};

export const EditDialog: Story = {
  render: () => (
    <MemoryEditDialog
      memory={FIXTURE_MEMORIES[0]}
      onClose={() => undefined}
      onSave={() => Promise.resolve()}
    />
  ),
};
