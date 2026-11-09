import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { Chip } from "../Chip/Chip";
import { PickerPopover } from "./PickerPopover";

const meta: Meta<typeof PickerPopover> = {
  title: "Components/PickerPopover",
  component: PickerPopover,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof PickerPopover>;

const MODELS = [
  { value: "opus", name: "Opus 5", description: "Most capable" },
  { value: "sonnet", name: "Sonnet 5", description: "Balanced" },
  { value: "haiku", name: "Haiku 4.5", description: "Fastest" },
];

/** Anchored above the trigger, so the stage sits the trigger near the bottom. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "flex-end",
        padding: 24,
        background: "var(--bg-primary)",
      }}
    >
      {children}
    </div>
  );
}

export const Single: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [model, setModel] = useState("sonnet");

    return (
      <Stage>
        <div ref={ref}>
          <Chip interactive onClick={() => setOpen((o) => !o)}>
            {MODELS.find((m) => m.value === model)?.name}
          </Chip>
          {open && (
            <PickerPopover triggerRef={ref} onClose={() => setOpen(false)}>
              <PickerPopover.Header>Switch model</PickerPopover.Header>
              {MODELS.map((m) => (
                <PickerPopover.Option
                  key={m.value}
                  name={m.name}
                  description={m.description}
                  selected={m.value === model}
                  onSelect={() => {
                    setModel(m.value);
                    setOpen(false);
                  }}
                />
              ))}
            </PickerPopover>
          )}
        </div>
      </Stage>
    );
  },
};

export const MultiSelect: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [picked, setPicked] = useState<string[]>(["opus"]);

    return (
      <Stage>
        <div ref={ref}>
          <Chip interactive onClick={() => setOpen((o) => !o)}>
            {picked.length} linked
          </Chip>
          {open && (
            <PickerPopover triggerRef={ref} onClose={() => setOpen(false)}>
              <PickerPopover.Header>Linked projects</PickerPopover.Header>
              {MODELS.map((m) => (
                <PickerPopover.Option
                  key={m.value}
                  name={m.name}
                  description={m.description}
                  selected={picked.includes(m.value)}
                  onSelect={() =>
                    setPicked((p) =>
                      p.includes(m.value)
                        ? p.filter((v) => v !== m.value)
                        : [...p, m.value],
                    )
                  }
                />
              ))}
            </PickerPopover>
          )}
        </div>
      </Stage>
    );
  },
};

export const WithStaticRowAndEmpty: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);

    return (
      <Stage>
        <div ref={ref}>
          <Chip interactive>Runner</Chip>
          <PickerPopover triggerRef={ref} onClose={() => {}}>
            <PickerPopover.Header>Runner</PickerPopover.Header>
            <PickerPopover.Static
              name="Claude Code"
              description="Fixed for this session"
            />
            <PickerPopover.Header>Linked projects</PickerPopover.Header>
            <PickerPopover.Empty>No other projects open</PickerPopover.Empty>
          </PickerPopover>
        </div>
      </Stage>
    );
  },
};

const RUNNERS = [
  { value: "claude-code", name: "Claude Code" },
  { value: "codex", name: "Codex" },
  {
    value: "gemini",
    name: "Gemini CLI",
    description: "Not installed — npm install -g @google/gemini-cli",
    disabled: true,
  },
];

/** A runner whose CLI is missing stays listed, greyed out, saying how to install it. */
export const WithDisabled: Story = {
  render: () => {
    const ref = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [runner, setRunner] = useState("claude-code");

    return (
      <Stage>
        <div ref={ref}>
          <Chip interactive onClick={() => setOpen((o) => !o)}>
            {RUNNERS.find((r) => r.value === runner)?.name}
          </Chip>
          {open && (
            <PickerPopover triggerRef={ref} onClose={() => setOpen(false)}>
              <PickerPopover.Header>Runner</PickerPopover.Header>
              {RUNNERS.map((r) => (
                <PickerPopover.Option
                  key={r.value}
                  description={r.description}
                  disabled={r.disabled}
                  name={r.name}
                  selected={r.value === runner}
                  onSelect={() => setRunner(r.value)}
                />
              ))}
            </PickerPopover>
          )}
        </div>
      </Stage>
    );
  },
};
