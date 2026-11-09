import type { Meta, StoryObj } from "@storybook/react";
import { remoteRunEntry, RunHistory } from "../AutomationDetailView/RunHistory";
import { FIXTURE_PROJECTS, fixtureRun } from "../AutomationFields/fixtures";
import { QuickRunView } from "./QuickRunView";

const noop = () => undefined;

const HISTORY = (
  <RunHistory
    empty="Nothing yet. A quick run is kept and swept like any other run."
    runs={[
      remoteRunEntry(
        fixtureRun({
          id: "q1",
          is_quick: true,
          automation_name: "Weekly summary",
        }),
        true,
      ),
    ]}
    title="Quick runs"
    onOpen={noop}
  />
);

const meta: Meta<typeof QuickRunView> = {
  title: "Automations/QuickRunView",
  component: QuickRunView,
  tags: ["autodocs"],
  args: { projects: FIXTURE_PROJECTS, history: HISTORY },
};
export default meta;
type Story = StoryObj<typeof QuickRunView>;

export const Default: Story = {
  args: {
    onRun: () => new Promise((r) => setTimeout(r, 600)),
    onRunLater: () => new Promise((r) => setTimeout(r, 600)),
  },
};

export const Refused: Story = {
  args: { onRun: () => Promise.reject(new Error("Spend ceiling reached.")) },
};

export const MonitorOnly: Story = { args: { onRun: undefined } };

export const NoHistory: Story = {
  args: {
    onRun: () => Promise.resolve(),
    history: (
      <RunHistory
        empty="Nothing yet. A quick run is kept and swept like any other run."
        runs={[]}
        title="Quick runs"
        onOpen={noop}
      />
    ),
  },
};
