import type { Meta, StoryObj } from "@storybook/react";
import { WebIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { GridScreen } from "../GridScreen/GridScreen";
import {
  PullRequestBuckets,
  PullRequestRow,
  type PullRequestRowModel,
} from "./PullRequestList";

const meta: Meta<typeof PullRequestBuckets> = {
  title: "Components/PullRequestList",
  component: PullRequestBuckets,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PullRequestBuckets>;

const pr = (
  number: number,
  title: string,
  over: Partial<PullRequestRowModel> = {},
): PullRequestRowModel => ({
  title,
  repo: "houwert/argus",
  number,
  author: "douwe",
  isDraft: false,
  updated: "3h ago",
  headRef: `feature/${number}`,
  reasons: [{ label: "Reviewer", tone: "success" }],
  ...over,
});

const row = (model: PullRequestRowModel, withActions = false) => (
  <PullRequestRow
    key={model.number}
    pr={model}
    onOpen={() => {}}
    actions={
      withActions ? (
        <Button variant="ghost" size="sm" aria-label="Open in browser">
          <WebIcon size={14} />
        </Button>
      ) : undefined
    }
  />
);

export const Bucketed: Story = {
  render: () => (
    <GridScreen>
      <PullRequestBuckets
        buckets={[
          {
            id: "awaiting-me",
            title: "Awaiting my review",
            attention: true,
            rows: [
              row(pr(412, "feat(web): land work card"), true),
              row(
                pr(409, "fix(agents): end a limit stall", {
                  reasons: [{ label: "Team review", tone: "success" }],
                }),
                true,
              ),
            ],
          },
          {
            id: "awaiting-others",
            title: "Awaiting another review",
            attention: false,
            rows: [
              row(
                pr(398, "refactor(web): port quick open", {
                  reasons: [{ label: "Author", tone: "accent" }],
                  review: { label: "Review required", tone: "warning" },
                }),
              ),
            ],
          },
          {
            id: "draft",
            title: "Draft",
            attention: false,
            rows: [
              row(
                pr(390, "wip: terminals", {
                  isDraft: true,
                  reasons: [{ label: "Author", tone: "accent" }],
                }),
              ),
            ],
          },
        ]}
      />
    </GridScreen>
  ),
};

export const AllClear: Story = {
  render: () => (
    <GridScreen>
      <PullRequestBuckets
        buckets={[
          {
            id: "other",
            title: "Other",
            attention: false,
            rows: [
              row(
                pr(301, "docs: routing", {
                  reasons: [{ label: "Mentioned", tone: "neutral" }],
                }),
              ),
            ],
          },
        ]}
      />
    </GridScreen>
  ),
};
