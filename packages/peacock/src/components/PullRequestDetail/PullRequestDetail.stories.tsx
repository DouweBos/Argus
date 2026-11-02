import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { WebIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { GridScreen } from "../GridScreen/GridScreen";
import { Markdown } from "../Markdown/Markdown";
import {
  MergeSplitButton,
  type PullRequestCheck,
  PullRequestCheckList,
  PullRequestChecksSummary,
  PullRequestCommentBox,
  PullRequestHeader,
  PullRequestTabs,
  PullRequestTimeline,
} from "./PullRequestDetail";

const meta: Meta<typeof PullRequestHeader> = {
  title: "Components/PullRequestDetail",
  component: PullRequestHeader,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PullRequestHeader>;

const CHECKS: PullRequestCheck[] = [
  { name: "lint", tone: "success", url: "https://example.com" },
  { name: "test (ubuntu-latest)", tone: "error", description: "failure" },
  { name: "build", tone: "warning", description: "in_progress" },
  { name: "deploy preview", tone: "neutral", description: "skipped" },
];

type Strategy = "merge" | "rebase" | "squash";

function Screen({ conflicting = false }: { conflicting?: boolean }) {
  const [tab, setTab] = useState<"checks" | "conversation">("conversation");
  const [strategy, setStrategy] = useState<Strategy>("squash");

  return (
    <GridScreen>
      <PullRequestHeader
        state={{ label: "Open", tone: "success" }}
        author="douwe"
        headRef="feature/land-work"
        baseRef="main"
        updated="3h ago"
        commits={4}
        changedFiles={12}
        additions={420}
        deletions={37}
        labels={["web", "parity"]}
        conflicting={conflicting}
        actions={
          <>
            <Button variant="ghost" size="sm" aria-label="Open in browser">
              <WebIcon size={14} />
            </Button>
            <MergeSplitButton
              strategy={strategy}
              options={[
                { value: "squash", label: "Squash and merge" },
                { value: "merge", label: "Create a merge commit" },
                { value: "rebase", label: "Rebase and merge" },
              ]}
              onStrategyChange={setStrategy}
              onMerge={() => {}}
              disabled={conflicting}
            />
          </>
        }
      />
      <PullRequestTabs
        tabs={[
          { id: "conversation", label: "Conversation" },
          { id: "checks", label: "Checks (1/4)" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "conversation" ? (
        <>
          <GridScreen.Section title="Conversation" count={2}>
            <PullRequestTimeline
              onOpenUrl={() => {}}
              entries={[
                {
                  id: "1",
                  author: "octocat",
                  age: "2h ago",
                  url: "https://example.com",
                  body: <Markdown text="Looks good, one nit below." />,
                  review: "Approved",
                  inline: [
                    {
                      id: "1a",
                      age: "2h ago",
                      body: <Markdown text="`busy` could be an enum." />,
                    },
                  ],
                },
                {
                  id: "2",
                  author: "douwe",
                  age: "1h ago",
                  body: <Markdown text="Done, thanks!" />,
                },
              ]}
            />
          </GridScreen.Section>
          <PullRequestChecksSummary
            checks={CHECKS}
            summary={{
              title: "1 check failing",
              tone: "error",
              passed: 2,
              failed: 1,
              pending: 1,
              total: 4,
            }}
            onOpenDetails={() => {}}
          />
          <GridScreen.Section title="Add a comment">
            <PullRequestCommentBox onSubmit={async () => {}} />
          </GridScreen.Section>
        </>
      ) : (
        <GridScreen.Section title="Checks" count={CHECKS.length}>
          <PullRequestCheckList checks={CHECKS} onOpenUrl={() => {}} />
        </GridScreen.Section>
      )}
    </GridScreen>
  );
}

export const Open: Story = { render: () => <Screen /> };

export const Conflicting: Story = { render: () => <Screen conflicting /> };

export const Merged: Story = {
  args: {
    state: { label: "Merged", tone: "accent" },
    author: "douwe",
    headRef: "feature/land-work",
    baseRef: "main",
    changedFiles: 3,
    additions: 12,
    deletions: 4,
  },
};

export const EmptyConversation: Story = {
  render: () => <PullRequestTimeline entries={[]} />,
};
