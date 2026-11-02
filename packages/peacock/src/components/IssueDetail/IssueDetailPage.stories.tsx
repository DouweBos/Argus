import type { LinearIssueDetail } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { IssueActivitySection } from "./IssueActivitySection";
import { IssueBody } from "./IssueBody";
import { IssueDetailPage } from "./IssueDetailPage";
import { IssueMediaEmbed } from "./IssueMediaEmbed";
import { IssueProperties } from "./IssueProperties";

const meta: Meta<typeof IssueDetailPage> = {
  title: "Screens/IssueDetailPage",
  component: IssueDetailPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A Linear issue as a full page: body, activity with reply boxes, and properties with status and priority menus (S / P). Options, stints, the timeline and labels come from `@argus/client-core`; data and the comment/update calls from the app.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof IssueDetailPage>;

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-02T10:00:00Z");

const ISSUE: LinearIssueDetail = {
  id: "i1",
  identifier: "ENG-18",
  title: "Board columns follow the workflow",
  description:
    "Columns should run **Triage → Backlog → Todo → In Progress → Done**.\n\n![recording.mov](https://uploads.linear.app/a/b/recording.mov)",
  url: "https://linear.app/acme/issue/ENG-18",
  branchName: "douwe/eng-18-board-columns",
  state: {
    id: "s2",
    name: "In Progress",
    type: "started",
    position: 2,
    color: "#f2c94c",
  },
  priority: 2,
  estimate: 3,
  estimateType: "tShirt",
  labelColors: [{ name: "Feature", color: "#bb87fc" }],
  teamId: "t",
  teamKey: "ENG",
  teamName: "Engineering",
  assignee: "Douwe Bos",
  assigneeAvatarUrl: null,
  creator: "Ann",
  dueDate: null,
  labels: ["Feature"],
  project: { id: "p", name: "Issues" },
  cycle: { id: "c", number: 59, name: null, isActive: true },
  parent: { identifier: "ENG-10", title: "Issues on every client" },
  pullRequestCount: 1,
  createdAt: NOW - 20 * DAY,
  updatedAt: NOW - DAY,
  comments: [
    {
      id: "c1",
      parentId: null,
      author: "Ann",
      body: "Should done columns stay hidden?",
      createdAt: NOW - 3 * DAY,
    },
    {
      id: "c2",
      parentId: "c1",
      author: "Douwe Bos",
      body: "Yes, until you show them.",
      createdAt: NOW - 2 * DAY,
    },
  ],
  history: [
    {
      id: "h1",
      createdAt: NOW - 20 * DAY,
      actor: "Ann",
      actorAvatarUrl: null,
      kind: "created",
      text: "created the issue",
    },
    {
      id: "h2",
      createdAt: NOW - 5 * DAY,
      actor: "Douwe Bos",
      actorAvatarUrl: null,
      kind: "priority",
      text: "set priority to High",
    },
  ],
  subscribers: [{ name: "Ann", avatarUrl: null }],
  relations: [
    {
      type: "blocks",
      identifier: "ENG-21",
      title: "Copy branch name",
      state: { name: "Todo", type: "unstarted" },
    },
  ],
  statusHistory: [
    { name: "Todo", type: "unstarted", enteredAt: NOW - 20 * DAY },
    { name: "In Progress", type: "started", enteredAt: NOW - 5 * DAY },
  ],
  attachments: [
    {
      title: "Board frame",
      subtitle: "Figma",
      url: "https://www.figma.com/design/abc/Board?node-id=1-2",
      createdAt: NOW - 4 * DAY,
    },
  ],
  children: [
    {
      identifier: "ENG-19",
      title: "Lanes per priority",
      state: { name: "Done", type: "completed" },
    },
  ],
} as LinearIssueDetail;

const ago = (ms: number) => `${Math.max(1, Math.round((NOW - ms) / DAY))}d ago`;
const date = (ms: number) => new Date(ms).toDateString();
const noop = () => {};

function Page({
  canEdit,
  mediaAsLink,
}: {
  canEdit: boolean;
  mediaAsLink: boolean;
}) {
  const embed = (kind: "image" | "link", url: string, label: string) =>
    url.includes("uploads.linear.app") ? (
      <IssueMediaEmbed
        kind={kind === "image" ? "image" : "video"}
        label={label}
        src={mediaAsLink ? "link" : null}
        url={url}
      />
    ) : null;

  return (
    <IssueDetailPage
      aside={
        <IssueProperties
          ago={ago}
          canEdit={canEdit}
          cycleLabel="Cycle 59"
          estimateLabel="M"
          formatDate={date}
          issue={ISSUE}
          priorityChange={ISSUE.history?.[1] ?? null}
          priorityOptions={[
            { id: "1", title: "Urgent", key: "1" },
            { id: "2", title: "High", key: "2" },
            { id: "3", title: "Medium", key: "3" },
            { id: "4", title: "Low", key: "4" },
            { id: "0", title: "No priority", key: "0" },
          ]}
          statusOptions={[
            {
              id: "s1",
              title: "Todo",
              key: "1",
              type: "unstarted",
              color: null,
            },
            {
              id: "s2",
              title: "In Progress",
              key: "2",
              type: "started",
              color: null,
            },
            {
              id: "s3",
              title: "Done",
              key: "3",
              type: "completed",
              color: null,
            },
          ]}
          statusStints={[
            { name: "Todo", type: "unstarted", duration: "2w" },
            { name: "In Progress", type: "started", duration: "5d" },
          ]}
          onChange={noop}
          onOpenExternal={noop}
          onOpenSession={null}
          onStart={canEdit ? noop : null}
        />
      }
      error={null}
      issue={ISSUE}
      issueRef="ENG-18"
      listTitle="Assigned to me"
      order={["ENG-12", "ENG-18", "ENG-21"]}
      onClose={noop}
      onOpen={noop}
      onOpenExternal={noop}
    >
      <IssueBody
        ago={ago}
        isDesignUrl={(url) => url.includes("figma.com")}
        issue={ISSUE}
        renderEmbed={embed}
        onOpenIssue={noop}
        onOpenResource={noop}
      />
      <IssueActivitySection
        ago={ago}
        issue={ISSUE}
        renderEmbed={embed}
        timeline={[
          { kind: "event", at: NOW - 20 * DAY, event: ISSUE.history![0] },
          {
            kind: "thread",
            at: NOW - 3 * DAY,
            thread: { root: ISSUE.comments[0], replies: [ISSUE.comments[1]] },
          },
          { kind: "event", at: NOW - 5 * DAY, event: ISSUE.history![1] },
        ]}
        onComment={canEdit ? () => Promise.resolve() : null}
      />
    </IssueDetailPage>
  );
}

export const Default: Story = {
  render: () => <Page canEdit mediaAsLink={false} />,
};

/** A monitor-only client: no menus, no comment boxes, no start. */
export const ReadOnly: Story = {
  render: () => <Page canEdit={false} mediaAsLink />,
};

export const Loading: Story = {
  args: {
    error: null,
    issue: null,
    issueRef: "ENG-18",
    listTitle: "Assigned to me",
    order: [],
    onClose: noop,
    onOpen: noop,
    onOpenExternal: noop,
  },
};

export const Failed: Story = {
  args: { ...Loading.args, error: "Linear has no issue ENG-18." },
};
