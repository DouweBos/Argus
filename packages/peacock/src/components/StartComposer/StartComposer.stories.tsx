import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FolderIcon } from "../../icons/Icons";
import { PickerChip } from "./PickerChip";
import { StartComposer } from "./StartComposer";
import {
  BranchChip,
  StartWorkspaceChip,
  type StartWorkspaceKind,
} from "./WorkspaceChips";

const meta: Meta<typeof StartComposer> = {
  title: "Components/StartComposer",
  component: StartComposer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Where an agent starts: the task, then where it runs (`StartWorkspaceChip`, `BranchChip`) and on what (`PickerChip` for model, mode, effort and linked projects). The caller owns the draft and the start.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof StartComposer>;

const BRANCHES = ["main", "origin/main", "release/2.4", "feat/login"];

const MODELS = [
  { value: "opus", name: "Opus", description: "Most capable" },
  { value: "sonnet", name: "Sonnet", description: "Balanced" },
  { value: "haiku", name: "Haiku", description: "Fastest" },
];

const MODES = [
  { value: "auto", name: "Auto" },
  { value: "ask", name: "Ask" },
  { value: "plan", name: "Plan" },
  { value: "review", name: "Review" },
];

function Playground({
  initialWorkspace = "worktree",
  initialPrompt = "",
}: {
  initialWorkspace?: StartWorkspaceKind;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [base, setBase] = useState<string | null>("origin/main");
  const [existing, setExisting] = useState<string | null>(null);
  const [model, setModel] = useState("sonnet");
  const [mode, setMode] = useState("auto");
  const [linked, setLinked] = useState<string[]>([]);
  const canSubmit =
    workspace === "existing" ? !!existing : prompt.trim().length > 0;

  return (
    <StartComposer
      canSubmit={canSubmit}
      chips={
        <>
          <StartWorkspaceChip
            currentBranch="main"
            currentLabel="Current checkout"
            existingBranch={existing}
            value={workspace}
            onChange={setWorkspace}
          />
          {workspace === "worktree" && (
            <BranchChip options={BRANCHES} value={base} onChange={setBase} />
          )}
          {workspace === "existing" && (
            <BranchChip
              format={(b) => b}
              header="Existing branch"
              options={BRANCHES.filter((b) => !b.startsWith("origin/"))}
              placeholder="Pick a branch"
              title="Branch to check out"
              value={existing}
              onChange={setExisting}
            />
          )}
          <PickerChip
            label={MODES.find((m) => m.value === mode)?.name}
            muted={mode === "auto"}
            options={MODES}
            selected={[mode]}
            title="Permission mode"
            onSelect={setMode}
          />
          <PickerChip
            mono
            muted
            label={MODELS.find((m) => m.value === model)?.name}
            options={MODELS}
            selected={[model]}
            title="Model"
            onSelect={setModel}
          />
          <PickerChip
            multiple
            empty="No other projects open"
            label={linked.length ? `${linked.length} linked` : "Link project"}
            leading={<FolderIcon size={11} />}
            muted={linked.length === 0}
            options={[
              { value: "/repo/api", name: "api", description: "~/code/api" },
              { value: "/repo/web", name: "web", description: "~/code/web" },
            ]}
            selected={linked}
            title="Link other project"
            onSelect={(path) =>
              setLinked((l) =>
                l.includes(path) ? l.filter((p) => p !== path) : [...l, path],
              )
            }
          />
        </>
      }
      prompt={prompt}
      submitLabel="Start agent"
      onAttach={() => {}}
      onPromptChange={setPrompt}
      onSubmit={() => setPrompt("")}
    />
  );
}

export const NewWorktree: Story = { render: () => <Playground /> };

export const CurrentCheckout: Story = {
  render: () => (
    <Playground
      initialPrompt="Make the login form validate on blur"
      initialWorkspace="current"
    />
  ),
};

export const ExistingBranch: Story = {
  render: () => <Playground initialWorkspace="existing" />,
};

export const Starting: Story = {
  args: {
    prompt: "Make the login form validate on blur",
    canSubmit: false,
    disabled: true,
    submitLabel: "Starting…",
    chips: (
      <StartWorkspaceChip
        currentLabel="Current checkout"
        value="worktree"
        onChange={() => {}}
      />
    ),
    onPromptChange: () => {},
    onSubmit: () => {},
  },
};
