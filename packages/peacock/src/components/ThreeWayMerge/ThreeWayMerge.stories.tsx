import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ThreeWayMerge } from "./ThreeWayMerge";

const meta: Meta<typeof ThreeWayMerge> = {
  title: "Git/ThreeWayMerge",
  component: ThreeWayMerge,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof ThreeWayMerge>;

const SIMPLE_OURS = "function greet(name) {\n  return `Hello, ${name}!`;\n}\n";
const SIMPLE_THEIRS =
  "function greet(name) {\n  return `Hi there, ${name}.`;\n}\n";
const SIMPLE_BASE = "function greet(name) {\n  return 'Hello';\n}\n";
const SIMPLE_MERGED =
  "function greet(name) {\n<<<<<<< HEAD\n  return `Hello, ${name}!`;\n=======\n  return `Hi there, ${name}.`;\n>>>>>>> theirs\n}\n";

const MULTI_MERGED = [
  "import a from 'a';",
  "<<<<<<< HEAD",
  "import b from 'b';",
  "=======",
  "import c from 'c';",
  ">>>>>>> theirs",
  "",
  "function f() {",
  "<<<<<<< HEAD",
  "  return 1;",
  "=======",
  "  return 2;",
  ">>>>>>> theirs",
  "}",
  "",
].join("\n");

function Wrapper(props: {
  base: string;
  ours: string;
  theirs: string;
  merged: string;
  readOnly?: boolean;
}) {
  const [merged, setMerged] = useState(props.merged);

  return (
    <div style={{ height: 700, display: "flex" }}>
      <ThreeWayMerge
        base={props.base}
        ours={props.ours}
        theirs={props.theirs}
        merged={merged}
        readOnly={props.readOnly}
        onMergedChange={setMerged}
        onMarkResolved={() => undefined}
      />
    </div>
  );
}

export const Simple: Story = {
  render: () => (
    <Wrapper
      base={SIMPLE_BASE}
      ours={SIMPLE_OURS}
      theirs={SIMPLE_THEIRS}
      merged={SIMPLE_MERGED}
    />
  ),
};

export const MultipleRegions: Story = {
  render: () => (
    <Wrapper
      base="// base"
      ours="// ours"
      theirs="// theirs"
      merged={MULTI_MERGED}
    />
  ),
};

export const LargeFile: Story = {
  render: () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    lines[100] = "<<<<<<< HEAD";
    lines.splice(101, 0, "  ours-100");
    lines.splice(102, 0, "=======");
    lines.splice(103, 0, "  theirs-100");
    lines.splice(104, 0, ">>>>>>> theirs");

    return (
      <Wrapper
        base="(base)"
        ours="(ours)"
        theirs="(theirs)"
        merged={lines.join("\n")}
      />
    );
  },
};

export const AllResolved: Story = {
  render: () => (
    <Wrapper
      base={SIMPLE_BASE}
      ours={SIMPLE_OURS}
      theirs={SIMPLE_THEIRS}
      merged={SIMPLE_OURS}
    />
  ),
};

export const ReadOnly: Story = {
  render: () => (
    <Wrapper
      base={SIMPLE_BASE}
      ours={SIMPLE_OURS}
      theirs={SIMPLE_THEIRS}
      merged={SIMPLE_MERGED}
      readOnly
    />
  ),
};
