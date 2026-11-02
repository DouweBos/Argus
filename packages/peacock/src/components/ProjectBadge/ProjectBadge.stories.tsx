import type { Meta, StoryObj } from "@storybook/react";
import { ProjectBadge } from "./ProjectBadge";

const meta: Meta<typeof ProjectBadge> = {
  title: "Primitives/ProjectBadge",
  component: ProjectBadge,
  args: { name: "argus-web", projectKey: "/Users/me/argus-web", size: "sm" },
};
export default meta;
type Story = StoryObj<typeof ProjectBadge>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <ProjectBadge {...args} size="sm" />
      <ProjectBadge {...args} size="md" />
      <ProjectBadge {...args} size="lg" />
    </div>
  ),
};

export const Palette: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      {["acme-web", "Argus", "media server", "docs", "ios-app", "tv"].map(
        (name) => (
          <ProjectBadge key={name} name={name} projectKey={`/src/${name}`} />
        ),
      )}
    </div>
  ),
};

/** No path to colour it: a neutral badge, as for a scratch pad. */
export const Neutral: Story = { args: { projectKey: undefined } };
