import type { RemoteAutomationDetail } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AutomationFields } from "./AutomationFields";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_DETAIL,
  FIXTURE_PROJECTS,
  FIXTURE_RUNNERS,
  FIXTURE_SOURCES,
} from "./fixtures";

const meta: Meta<typeof AutomationFields> = {
  title: "Automations/AutomationFields",
  component: AutomationFields,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AutomationFields>;

function Live({ initial }: { initial: RemoteAutomationDetail }) {
  const [draft, setDraft] = useState(initial);

  return (
    <AutomationFields
      draft={draft}
      projects={FIXTURE_PROJECTS}
      accounts={FIXTURE_ACCOUNTS}
      activeAccountId="default"
      runners={FIXTURE_RUNNERS}
      sources={FIXTURE_SOURCES}
      onChange={setDraft}
      onRevisePlaybook={() => undefined}
      onRotateWebhookSecret={() =>
        Promise.resolve({
          url: draft.webhook?.url ?? null,
          secret: "q4Jx2nV8bWm1cR7tLs0yPz3kE6hA9dFg5uTiOw",
        })
      }
    />
  );
}

export const Scheduled: Story = {
  render: () => <Live initial={FIXTURE_DETAIL} />,
};

/** Only runs when its precheck exits 0. */
export const WithPrecheck: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        precheck_command: "git fetch -q && ! git diff --quiet HEAD @{u}",
        precheck_timeout_seconds: 30,
        continue_conversation: true,
      }}
    />
  ),
};

export const Manual: Story = {
  render: () => (
    <Live initial={{ ...FIXTURE_DETAIL, trigger_kind: "manual", cron: null }} />
  ),
};

/** Fires on Slack messages; edited on the Mac, shown here. */
export const SlackTrigger: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        trigger_kind: "slack",
        cron: null,
        slack_channel: { id: "C1", name: "deploys" },
        slack_match: "prefix",
        slack_text: "deploy failed",
      }}
    />
  ),
};

/** Fires once at a date and time, then pauses itself. */
export const Once: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        trigger_kind: "once",
        cron: null,
        run_at: "2030-03-04T09:00",
      }}
    />
  ),
};

/** Armed for a time that has already gone by. */
export const OncePassed: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        enabled: true,
        trigger_kind: "once",
        cron: null,
        run_at: "2020-01-01T09:00",
      }}
    />
  ),
};

/** Runs when one of your pull requests goes red. */
export const Signal: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        enabled: true,
        trigger_kind: "signal",
        cron: null,
        signal: {
          on: ["ci_failed", "mentioned"],
          labels: [],
          fire: "each",
          max_runs_per_hour: 4,
        },
      }}
    />
  ),
};

/** Called from outside; the secret shows once after Generate. */
export const Webhook: Story = {
  render: () => (
    <Live
      initial={{
        ...FIXTURE_DETAIL,
        enabled: true,
        trigger_kind: "webhook",
        cron: null,
        webhook: {
          fire: "batch",
          max_runs_per_hour: 6,
          url: "https://studio-mac.example.dev/hooks/automations/a4",
          has_secret: false,
        },
      }}
    />
  ),
};

export const BadCron: Story = {
  render: () => <Live initial={{ ...FIXTURE_DETAIL, cron: "every morning" }} />,
};

export const CustomRunner: Story = {
  render: () => (
    <Live initial={{ ...FIXTURE_DETAIL, runner: "local", model: "qwen" }} />
  ),
};

/** Pinned to the work account: the run never falls back to another one. */
export const PinnedAccount: Story = {
  render: () => (
    <Live initial={{ ...FIXTURE_DETAIL, claude_account_id: "work" }} />
  ),
};

export const ReadOnly: Story = {
  args: {
    disabled: true,
    draft: FIXTURE_DETAIL,
    projects: FIXTURE_PROJECTS,
    runners: [],
    sources: FIXTURE_SOURCES,
    onChange: () => undefined,
  },
};
