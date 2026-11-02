import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CommitForm, type CommitFormOptions } from "../CommitForm/CommitForm";
import { LandWorkCard } from "./LandWorkCard";

const meta: Meta<typeof LandWorkCard> = {
  title: "Components/LandWorkCard",
  component: LandWorkCard,
  args: {
    branch: "feature/land-work",
    base: "main",
    pushLabel: "Push 2 commits",
    onPush: () => {},
    onMerge: () => {},
    onOpenPullRequest: () => {},
    onChangeBase: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LandWorkCard>;

function Form() {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<CommitFormOptions>({
    amend: false,
    signOff: false,
    sign: false,
  });

  return (
    <CommitForm
      allowsAmend
      summary={summary}
      description={description}
      onSummaryChange={setSummary}
      onDescriptionChange={setDescription}
      options={options}
      onOptionsChange={setOptions}
      identity="Douwe Bos <douwe@example.com>"
      changeSummary="3 changed files · +42 −7"
      onCommit={() => {}}
    />
  );
}

export const Uncommitted: Story = {
  args: { clean: false, children: <Form /> },
};

export const Clean: Story = {
  args: { clean: true, note: "Committed." },
};

export const Blocked: Story = {
  args: {
    clean: true,
    blockers: ["main is protected. Open a pull request instead."],
  },
};

export const Pushing: Story = {
  args: { clean: true, busy: "push" },
};

export const Merging: Story = {
  args: { clean: true, busy: "merge" },
};

export const UnknownBase: Story = {
  args: { clean: true, base: "the base branch", onChangeBase: undefined },
};
