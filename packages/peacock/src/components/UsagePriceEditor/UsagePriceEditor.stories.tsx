import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  type UsagePriceEditorProps,
  type UsagePriceRowData,
  UsagePriceEditor,
} from "./UsagePriceEditor";

const empty = { input: "", output: "", cacheRead: "", cacheWrite: "" };

const rows: UsagePriceRowData[] = [
  {
    model: "local-llama-70b",
    values: { input: "0", output: "0", cacheRead: "", cacheWrite: "" },
    placeholders: {
      input: "",
      output: "",
      cacheRead: "= input",
      cacheWrite: "= input",
    },
    mapTo: "",
    custom: true,
    reset: false,
    resettable: true,
  },
  {
    model: "claude-opus-preview",
    values: empty,
    placeholders: {
      input: "",
      output: "",
      cacheRead: "= input",
      cacheWrite: "= input",
    },
    mapTo: "claude-opus-4-5",
    custom: true,
    reset: false,
    resettable: true,
  },
  {
    model: "gpt-5.1-codex",
    values: { ...empty, output: "8" },
    placeholders: {
      input: "1.25",
      output: "10",
      cacheRead: "0.125",
      cacheWrite: "1.25",
    },
    mapTo: "",
    custom: false,
    reset: false,
    resettable: true,
  },
  {
    model: "claude-opus-4-5",
    values: empty,
    placeholders: {
      input: "5",
      output: "25",
      cacheRead: "0.5",
      cacheWrite: "6.25",
    },
    mapTo: "",
    custom: false,
    reset: false,
    resettable: false,
  },
  {
    model: "grok-code-fast-1",
    values: { input: "0.2", output: "1.5", cacheRead: "", cacheWrite: "" },
    placeholders: {
      input: "0.2",
      output: "1.5",
      cacheRead: "0.02",
      cacheWrite: "0.2",
    },
    mapTo: "",
    custom: true,
    reset: true,
    resettable: true,
  },
];

const noop = () => {};

const base: UsagePriceEditorProps = {
  rows,
  loading: false,
  loadError: null,
  onRetry: noop,
  error: null,
  saving: false,
  dirty: true,
  disabled: false,
  onChange: noop,
  onReset: noop,
  onUndo: noop,
  onAdd: noop,
  onSave: noop,
  onCancel: noop,
};

const meta: Meta<typeof UsagePriceEditor> = {
  title: "Screens/UsagePriceEditor",
  component: UsagePriceEditor,
  args: base,
  render: (args) => (
    <div style={{ height: 560, display: "flex" }}>
      <UsagePriceEditor {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof UsagePriceEditor>;

/** Custom, mapped, edited, list-priced and reset-until-saved rows. */
export const Default: Story = {};

export const SaveRefused: Story = {
  args: {
    error:
      "claude-opus-preview can't be mapped to local-llama-70b: it's mapped itself.",
  },
};

export const Saving: Story = { args: { saving: true } };

export const ReadOnly: Story = { args: { disabled: true, dirty: false } };

export const Loading: Story = { args: { rows: [], loading: true } };

export const LoadFailed: Story = {
  args: { rows: [], loadError: "The computer didn't answer." },
};

export const Empty: Story = { args: { rows: [], dirty: false } };

function EditableDemo() {
  const [list, setList] = useState(rows);

  return (
    <div style={{ height: 560, display: "flex" }}>
      <UsagePriceEditor
        {...base}
        rows={list}
        onAdd={(model) =>
          setList((l) => [
            {
              model,
              values: empty,
              placeholders: {
                input: "",
                output: "",
                cacheRead: "= input",
                cacheWrite: "= input",
              },
              mapTo: "",
              custom: false,
              reset: false,
              resettable: true,
            },
            ...l,
          ])
        }
        onChange={(model, field, value) =>
          setList((l) =>
            l.map((r) => {
              if (r.model !== model) {
                return r;
              }

              return field === "mapTo"
                ? { ...r, mapTo: value }
                : { ...r, values: { ...r.values, [field]: value } };
            }),
          )
        }
        onReset={(model) =>
          setList((l) =>
            l.map((r) => (r.model === model ? { ...r, reset: true } : r)),
          )
        }
        onUndo={(model) =>
          setList((l) =>
            l.map((r) => (r.model === model ? { ...r, reset: false } : r)),
          )
        }
      />
    </div>
  );
}

export const Editable: Story = { render: () => <EditableDemo /> };
