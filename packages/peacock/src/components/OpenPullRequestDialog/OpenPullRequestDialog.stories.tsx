import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  OpenPullRequestDialog,
  type OpenPullRequestDialogProps,
} from "./OpenPullRequestDialog";

const meta: Meta<typeof OpenPullRequestDialog> = {
  title: "Components/OpenPullRequestDialog",
  component: OpenPullRequestDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof OpenPullRequestDialog>;

const TEMPLATE = "## Summary\n\n## Test plan\n";

function Interactive(props: Partial<OpenPullRequestDialogProps>) {
  const [title, setTitle] = useState("feat(web): land work from the browser");
  const [body, setBody] = useState(TEMPLATE);
  const [draft, setDraft] = useState(true);
  const [base, setBase] = useState("main");
  const [head, setHead] = useState("feature/land-work");

  return (
    <OpenPullRequestDialog
      title={title}
      onTitleChange={setTitle}
      body={body}
      onBodyChange={setBody}
      draft={draft}
      onDraftChange={setDraft}
      onFill={() => setBody("## Summary\n\nFilled in by Claude.")}
      submitLabel={draft ? "Push and open draft" : "Push and open"}
      onSubmit={() => {}}
      onClose={() => {}}
      branches={
        props.route
          ? undefined
          : {
              base,
              head,
              options: ["main", "feature/land-work", "release/1.4"],
              onBaseChange: setBase,
              onHeadChange: setHead,
            }
      }
      {...props}
    />
  );
}

/** The desktop: the caller picks base and head. */
export const PickBranches: Story = { render: () => <Interactive /> };

/** The web and the phone: the computer decides from the session. */
export const FromSession: Story = {
  render: () => <Interactive route="feature/land-work → main" />,
};

export const PickSession: Story = {
  render: () => (
    <Interactive
      route="feature/land-work → main"
      choices={[
        { value: "a", label: "land-work" },
        { value: "b", label: "terminals" },
      ]}
      choice="a"
      onChoiceChange={() => {}}
    />
  ),
};

export const Filling: Story = {
  render: () => <Interactive route="feature/land-work → main" filling />,
};

export const Failed: Story = {
  render: () => (
    <Interactive
      route="feature/land-work → main"
      error="Couldn't push feature/land-work — rejected (non-fast-forward)"
    />
  ),
};

export const Submitting: Story = {
  render: () => (
    <Interactive
      route="feature/land-work → main"
      submitting
      submitLabel="Pushing…"
    />
  ),
};

export const Opened: Story = {
  render: () => (
    <Interactive
      created={{
        url: "https://github.com/houwert/argus/pull/412",
        onOpen: () => {},
        onCopy: () => {},
      }}
    />
  ),
};
