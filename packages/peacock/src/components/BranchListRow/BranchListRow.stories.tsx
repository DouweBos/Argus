import type { RemoteGitBranch } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { BranchListRow } from "./BranchListRow";

const meta: Meta<typeof BranchListRow> = {
  title: "Components/BranchListRow",
  component: BranchListRow,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 480 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof BranchListRow>;

const base: RemoteGitBranch = {
  name: "main",
  scope: "local",
  is_current: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  last_commit_subject: "docs(plan): tick web parity milestone 4",
};

export const Current: Story = {
  args: {
    branch: { ...base, is_current: true, pinned: true },
    onClick: () => {},
    onMenu: () => {},
  },
};

export const AheadBehind: Story = {
  args: {
    branch: {
      ...base,
      name: "feature/land-work",
      upstream: null,
      ahead: 3,
      behind: 1,
      last_commit_subject: "feat(web): land work card",
    },
    onClick: () => {},
    onMenu: () => {},
  },
};

export const RemoteOnly: Story = {
  args: {
    branch: {
      ...base,
      name: "release/1.4",
      scope: "remote",
      remote: "origin",
      upstream: null,
    },
    onClick: () => {},
    onMenu: () => {},
  },
};

export const ReadOnly: Story = {
  args: { branch: base, onClick: () => {} },
};
