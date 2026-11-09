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
    />
  );
}

export const Scheduled: Story = {
  render: () => <Live initial={FIXTURE_DETAIL} />,
};

export const Manual: Story = {
  render: () => (
    <Live initial={{ ...FIXTURE_DETAIL, trigger_kind: "manual", cron: null }} />
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
