import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { ProposalCard } from "./ProposalCard";

const meta: Meta<typeof ProposalCard> = {
  title: "Primitives/ProposalCard",
  component: ProposalCard,
  tags: ["autodocs"],
  args: {
    title: "Fix the crash when opening a deleted worktree",
    summary:
      "argus#412 reproduces every time: the sidebar reads the worktree path after it was removed on disk.",
    rationale: "Two-line fix, the failing path is already covered by a test.",
    confidence: 0.9,
    sourceLabel: "argus#412",
    primary: { kind: "start", label: "Start", onClick: () => undefined },
    onDismiss: () => undefined,
    onResolve: () => undefined,
    onOpenSource: () => undefined,
    onOpenRun: () => undefined,
    meta: (
      <>
        <Badge tone="neutral">Argus</Badge>
        <Badge tone="accent">start session</Badge>
      </>
    ),
  },
};
export default meta;
type Story = StoryObj<typeof ProposalCard>;

export const Confident: Story = {};

export const Unsure: Story = {
  args: {
    title: "Triage the flaky simulator boot",
    summary:
      "Three runs failed to boot a simulator this week, all on the same runtime.",
    rationale: "No clear owner and the logs disagree — this may need a human.",
    confidence: 0.35,
    meta: <Badge tone="warning">needs info</Badge>,
  },
};

/** The next move is a human's, so the card says so instead of offering work. */
export const OpensSomething: Story = {
  args: {
    title: "Get PR #6478 reviewed and merged",
    summary:
      "The work is already written and mergeable. It has been sitting at REVIEW_REQUIRED with no human review.",
    rationale: "Someone else is waiting on it and no code needs writing.",
    confidence: 0.6,
    sourceLabel: "STR-3486",
    primary: {
      kind: "open",
      label: "Open PR #6478",
      onClick: () => undefined,
    },
    meta: <Badge tone="accent">worth a review</Badge>,
  },
};

/** Nothing to press, so marking it done is the card's own primary action. */
export const NothingToStart: Story = {
  args: {
    title: "Two Roku tickets are tracking the same campaignId change",
    summary: "Noted so the duplicate does not surprise anyone at standup.",
    confidence: 0.5,
    primary: undefined,
    onOpenSource: undefined,
    sourceLabel: undefined,
    meta: <Badge tone="neutral">suggests ignoring</Badge>,
  },
};

/** No "Mark as done": every ending this one has runs through Argus. */
export const WithoutResolve: Story = {
  args: { onResolve: undefined },
};

export const WithoutSource: Story = {
  args: { onOpenSource: undefined, sourceLabel: undefined },
};

export const Busy: Story = { args: { busy: true } };

/** A start in flight: the actions give way to where it has got to. */
export const Starting: Story = { args: { progress: "Running setup…" } };

/** The last start failed; the reason sits above actions that can try again. */
export const StartFailed: Story = {
  args: {
    error: {
      title: "Couldn't start.",
      detail:
        "mise ERROR Config files in /Volumes/External/wt/mise.toml are not trusted. Trust them with `mise trust`.",
    },
    primary: { kind: "start", label: "Try again", onClick: () => undefined },
  },
};

/** Cleared by a later run of the same automation — readable, not actionable. */
export const Cleared: Story = {
  args: {
    decided: "Withdrawn by Morning triage — PR #6478 was merged on Tuesday.",
    meta: <Badge tone="neutral">withdrawn</Badge>,
  },
};

/** A cleanup the janitor is sure about. The button asks once more first. */
export const Destructive: Story = {
  args: {
    title: "douwe/cast-pms-logging landed in staging four weeks ago",
    summary:
      "All six commits are in `origin/staging` by patch id, and PR #118 was squash-merged on 8 September.",
    rationale: "Nothing on the remote is holding it and nothing would be lost.",
    confidence: 0.95,
    primary: {
      kind: "destroy",
      label: "Delete the branch",
      confirm: "git branch -D douwe/cast-pms-logging — this cannot be undone.",
      onClick: () => undefined,
    },
    onOpenSource: undefined,
    sourceLabel: undefined,
    meta: <Badge tone="neutral">vizbee-chromecast-receiver</Badge>,
  },
};

/** Automations write markdown — code spans, lists and links all render. */
export const MarkdownBody: Story = {
  args: {
    title: "Harden the two iOS modal-dismissal assertions that flake nightly",
    summary: [
      "Two of the three iOS phone failures last night share one root cause: a",
      "`tapOn` that is supposed to dismiss a modal is treated as guaranteed.",
      "",
      "**1. `ratings-and-reviews.responsive` — no wait after the Save tap**",
      "",
      "```yaml",
      "- tapOn:",
      "    id: review-action-editReview",
      "- assertVisible:",
      "    id: ${output.movieList[0].screenId}",
      "```",
      "",
      "- Wrap both post-tap asserts in `extendedWaitUntil`",
      "- Retry the Done tap instead of waiting harder",
      "",
      "See [run 35679331976](https://github.com/acme/app/actions).",
    ].join("\n"),
    rationale:
      "Both failures are confirmed from screenshots, and both have a _same-repo precedent_ for the fix.",
    confidence: 0.8,
  },
};

/** "Mostly right, but…" — the note either starts it or goes back for a rework. */
export const WithNote: Story = {
  args: {
    onRequestRevision: () => undefined,
    onStartWithNote: () => undefined,
  },
};

/** A revision already asked for, waiting on the automation's next run. */
export const RevisionPending: Story = {
  args: {
    onRequestRevision: () => undefined,
    onStartWithNote: () => undefined,
    revisionRequest: "Scope it to the flaky test, not the whole suite.",
  },
};
