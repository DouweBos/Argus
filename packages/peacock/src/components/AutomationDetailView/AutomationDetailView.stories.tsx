import type { Meta, StoryObj } from "@storybook/react";
import { AutomationFields } from "../AutomationFields/AutomationFields";
import {
  FIXTURE_CALIBRATION,
  FIXTURE_DETAIL,
  FIXTURE_MEMORIES,
  FIXTURE_PROJECTS,
  FIXTURE_SOURCES,
  fixtureRun,
} from "../AutomationFields/fixtures";
import { AutomationMemories } from "../AutomationMemories/AutomationMemories";
import { AutomationTrackRecord } from "../AutomationTrackRecord/AutomationTrackRecord";
import { Button } from "../Button/Button";
import { Toggle } from "../Toggle/Toggle";
import { AutomationDetailView } from "./AutomationDetailView";
import { remoteRunEntry, RunHistory } from "./RunHistory";

const noop = () => undefined;

const meta: Meta<typeof AutomationDetailView> = {
  title: "Automations/AutomationDetailView",
  component: AutomationDetailView,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AutomationDetailView>;

export const Default: Story = {
  args: {
    name: "Morning triage",
    meta: "09:00 weekdays · next Nov 3, 09:00 (in 18h)",
    actions: (
      <>
        <Toggle checked onChange={noop}>
          Enabled
        </Toggle>
        <Button size="sm" variant="secondary">
          Run now
        </Button>
        <Button size="sm" variant="ghost">
          Delete
        </Button>
      </>
    ),
    trackRecord: <AutomationTrackRecord calibration={FIXTURE_CALIBRATION} />,
    saveAction: (
      <Button disabled size="sm">
        Saved
      </Button>
    ),
    configuration: (
      <AutomationFields
        draft={FIXTURE_DETAIL}
        projects={FIXTURE_PROJECTS}
        runners={[]}
        sources={FIXTURE_SOURCES}
        onChange={noop}
      />
    ),
    memories: (
      <AutomationMemories memories={FIXTURE_MEMORIES} onDelete={noop} />
    ),
    runs: (
      <RunHistory
        empty="This automation has never run."
        runs={[
          remoteRunEntry(fixtureRun()),
          remoteRunEntry(
            fixtureRun({
              id: "r2",
              status: "failed",
              error: "gh: not authenticated",
            }),
          ),
        ]}
        onOpen={noop}
      />
    ),
  },
};

export const NeverRan: Story = {
  args: {
    ...Default.args,
    trackRecord: undefined,
    runs: (
      <RunHistory
        empty="This automation has never run. Press Run now to see what it does."
        runs={[]}
        onOpen={noop}
      />
    ),
  },
};

export const Loading: Story = {
  args: { name: null, loading: true, configuration: null, runs: null },
};

export const Missing: Story = {
  args: {
    name: null,
    configuration: null,
    runs: null,
    missingAction: <Button size="sm">Back to automations</Button>,
  },
};
