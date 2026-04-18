import type { Meta, StoryObj } from "@storybook/react";
import { FeedItem } from "./FeedItem";
import { Button } from "../Button/Button";

const meta: Meta<typeof FeedItem> = {
  title: "Composites/FeedItem",
  component: FeedItem,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof FeedItem>;

export const Feed: Story = {
  render: () => (
    <div
      style={{
        width: 560,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <FeedItem
        kind="tool_call"
        status="running"
        project="Argus"
        agent="feat/workspace-card"
        text="Edit WorkspaceCard.tsx"
        time="just now"
        mono
      />
      <FeedItem
        kind="permission"
        status="pending"
        project="Argus"
        agent="fix/diff-hunk-staging"
        text="requests shell: rm -rf node_modules"
        time="12s"
        mono
        actions={
          <>
            <Button size="sm" variant="secondary">
              Allow
            </Button>
            <Button size="sm" variant="ghost">
              Always allow
            </Button>
            <Button size="sm" variant="danger">
              Deny
            </Button>
          </>
        }
      />
      <FeedItem
        kind="commit"
        status="done"
        project="pocketbase-ios"
        agent="feat/auth-flow"
        text="Add KeychainAuthStore + biometric unlock"
        time="1m"
      />
      <FeedItem
        kind="build"
        status="error"
        project="linear-web"
        agent="feat/notifications-v2"
        text="build failed · 3 errors in Inbox.tsx"
        time="2m"
        mono
      />
      <FeedItem
        kind="merge"
        status="done"
        project="Argus"
        agent="feat/permission-broker"
        text="merged into main"
        time="8m"
      />
    </div>
  ),
};
