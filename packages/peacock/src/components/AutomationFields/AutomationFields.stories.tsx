import type { RemoteAutomationDetail } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AutomationFields } from "./AutomationFields";
import {
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

export const BadCron: Story = {
  render: () => <Live initial={{ ...FIXTURE_DETAIL, cron: "every morning" }} />,
};

export const CustomRunner: Story = {
  render: () => (
    <Live initial={{ ...FIXTURE_DETAIL, runner: "local", model: "qwen" }} />
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
