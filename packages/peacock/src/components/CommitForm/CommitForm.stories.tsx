import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  CommitForm,
  type CommitFormOptions,
  type CommitFormProps,
} from "./CommitForm";

const meta: Meta<typeof CommitForm> = {
  title: "Components/CommitForm",
  component: CommitForm,
};
export default meta;
type Story = StoryObj<typeof CommitForm>;

function Interactive(props: Partial<CommitFormProps>) {
  const [summary, setSummary] = useState(props.summary ?? "");
  const [description, setDescription] = useState(props.description ?? "");
  const [options, setOptions] = useState<CommitFormOptions>(
    props.options ?? { amend: false, signOff: false, sign: false },
  );

  return (
    <div style={{ maxWidth: 480 }}>
      <CommitForm
        changeSummary="3 changed files · +42 −7"
        onCommit={() => {}}
        {...props}
        summary={summary}
        description={description}
        onSummaryChange={setSummary}
        onDescriptionChange={setDescription}
        options={options}
        onOptionsChange={setOptions}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <Interactive identity="Douwe Bos <douwe@example.com>" />,
};

export const AllOptions: Story = {
  render: () => (
    <Interactive
      allowsAmend
      canSign
      identity="Douwe Bos <douwe@example.com>"
      summary="feat(web): ship work"
      description="Commit, push and merge from the browser."
      options={{ amend: false, signOff: true, sign: true }}
    />
  ),
};

export const Amending: Story = {
  render: () => (
    <Interactive
      allowsAmend
      summary="feat(web): ship work"
      options={{ amend: true, signOff: false, sign: false }}
    />
  ),
};

export const Committing: Story = {
  render: () => <Interactive committing summary="feat(web): ship work" />,
};
