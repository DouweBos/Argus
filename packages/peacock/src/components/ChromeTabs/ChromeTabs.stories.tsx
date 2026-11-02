import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  BranchIcon,
  GitChangesIcon,
  PullRequestIcon,
  StashIcon,
} from "../../icons/Icons";
import { ChromeTabs } from "./ChromeTabs";

const meta: Meta<typeof ChromeTabs> = {
  title: "Primitives/ChromeTabs",
  component: ChromeTabs,
};
export default meta;
type Story = StoryObj<typeof ChromeTabs>;

type View = "branches" | "changes" | "pulls" | "stashes";

function GitViews() {
  const [view, setView] = useState<View>("changes");

  return (
    <ChromeTabs<View>
      selectedId={view}
      tabs={[
        {
          id: "changes",
          title: "Changes",
          icon: <GitChangesIcon size={13} />,
          count: 3,
        },
        { id: "branches", title: "Branches", icon: <BranchIcon size={12} /> },
        {
          id: "stashes",
          title: "Stashes & Tags",
          icon: <StashIcon size={13} />,
        },
        {
          id: "pulls",
          title: "Pull Requests",
          icon: <PullRequestIcon size={13} />,
        },
      ]}
      onSelect={setView}
    />
  );
}

export const Default: Story = { render: () => <GitViews /> };
