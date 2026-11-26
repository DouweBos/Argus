import type { Meta, StoryObj } from "@storybook/react";
import { CrossProjectRepoList } from "./CrossProjectRepoList";

const meta: Meta<typeof CrossProjectRepoList> = {
  title: "Git/CrossProjectRepoList",
  component: CrossProjectRepoList,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 360, background: "var(--surface-2)", padding: 8 }}>
        <Story />
      </div>
    ),
  ],
  args: { onSelect: () => {} },
};
export default meta;
type Story = StoryObj<typeof CrossProjectRepoList>;

const branch = "feat/merge-strategy";

/** The repository on screen first, one merged, one still setting up, one whose setup failed. */
export const Default: Story = {
  args: {
    currentSessionId: "luma",
    repos: [
      { sessionId: "luma", repoRoot: "/p/luma", name: "luma", branch },
      {
        sessionId: "argus",
        repoRoot: "/p/Argus",
        name: "Argus",
        branch,
        state: { label: "Merged", tone: "success" },
      },
      {
        sessionId: "conductor",
        repoRoot: "/p/conductor",
        name: "conductor",
        branch,
        state: { label: "Setting up", tone: "neutral" },
      },
      {
        sessionId: "api",
        repoRoot: "/p/api",
        name: "api",
        branch,
        state: { label: "Setup failed", tone: "error" },
      },
    ],
  },
};

/** An open pull request on the repository picked. */
export const OpenPullRequest: Story = {
  args: {
    currentSessionId: "argus",
    repos: [
      { sessionId: "luma", repoRoot: "/p/luma", name: "luma", branch },
      {
        sessionId: "argus",
        repoRoot: "/p/Argus",
        name: "Argus",
        branch,
        state: { label: "PR #431", tone: "accent" },
      },
    ],
  },
};
