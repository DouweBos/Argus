import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CommitComposer, type CommitComposerProps } from "./CommitComposer";

const meta: Meta<typeof CommitComposer> = {
  title: "Components/CommitComposer",
  component: CommitComposer,
};
export default meta;
type Story = StoryObj<typeof CommitComposer>;

function Interactive(props: Partial<CommitComposerProps>) {
  const [subject, setSubject] = useState(props.subject ?? "");
  const [body, setBody] = useState(props.body ?? "");

  return (
    <div style={{ width: 420 }}>
      <CommitComposer
        {...props}
        subject={subject}
        body={body}
        onSubjectChange={setSubject}
        onBodyChange={setBody}
      />
    </div>
  );
}

const COMMITS = [
  { subject: "feat(web): land work card", abbreviatedHash: "e5f6a7b" },
  { subject: "fix(agents): end a limit stall", abbreviatedHash: "a1b2c3d" },
];
const FILES = [
  { newPath: "app/lib/router.tsx", oldPath: "app/lib/router.tsx" },
  { newPath: "packages/peacock/src/index.ts", oldPath: "" },
];

/** Type `\` for changed files, `c:` or `fixup! ` for recent commits, `#` for issues. */
export const SubjectOnly: Story = {
  render: () => <Interactive recentCommits={COMMITS} diffFiles={FILES} />,
};

export const WithDescription: Story = {
  render: () => (
    <Interactive
      showBody
      subjectPlaceholder="Summary"
      bodyPlaceholder="Description"
      subject="feat(web): ship work from the browser"
      body="Commit, push and merge without the computer."
      recentCommits={COMMITS}
      diffFiles={FILES}
      ghIssues={[{ number: 42, title: "Web parity" }]}
    />
  ),
};

export const Warned: Story = {
  render: () => (
    <Interactive
      subjectWarn
      subject="feat(web): a summary that runs past fifty characters easily"
    />
  ),
};

export const Disabled: Story = {
  render: () => <Interactive showBody disabled subject="Committing…" />,
};
