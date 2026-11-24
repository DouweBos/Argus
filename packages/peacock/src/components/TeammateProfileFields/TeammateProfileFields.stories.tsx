import type { TeammateDraft } from "@argus/client-core";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TeammateProfileFields } from "./TeammateProfileFields";

const DRAFT: TeammateDraft = {
  name: "CI Fixer",
  handle: "ci-fixer",
  tagline: "Keeps main green: reads failing checks and opens a fix.",
  color: "orange",
  avatar: { kind: "symbol", symbol: "wrench" },
  soul: "# CI Fixer\n\nYou keep `main` green. When a check fails, read its log, find the smallest fix and open a draft PR.\n",
  autonomy: "draft",
  repoRoots: ["/Users/me/Projects/argus"],
};

const PROJECTS = [
  { id: "/Users/me/Projects/argus", label: "argus" },
  { id: "/Users/me/Projects/peacock", label: "peacock" },
  { id: "/Users/me/Projects/site", label: "site" },
];

function Editable({ initial }: { initial: TeammateDraft }) {
  const [draft, setDraft] = useState(initial);

  return (
    <TeammateProfileFields
      draft={draft}
      projects={PROJECTS}
      onChange={setDraft}
      onReviseSoul={() => undefined}
    />
  );
}

const meta: Meta<typeof TeammateProfileFields> = {
  title: "Automations/TeammateProfileFields",
  component: TeammateProfileFields,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof TeammateProfileFields>;

export const Default: Story = { render: () => <Editable initial={DRAFT} /> };

export const InheritsWithInitials: Story = {
  render: () => (
    <Editable
      initial={{
        ...DRAFT,
        name: "Release Notes Writer",
        handle: "Release Notes",
        avatar: { kind: "initials" },
        color: "teal",
        autonomy: null,
      }}
    />
  ),
};

export const ReadOnly: Story = {
  args: {
    draft: DRAFT,
    projects: PROJECTS,
    disabled: true,
    onChange: () => undefined,
  },
};
