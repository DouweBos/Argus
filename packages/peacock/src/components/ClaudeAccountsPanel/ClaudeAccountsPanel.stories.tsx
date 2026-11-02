import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  type ClaudeAccountKind,
  type ClaudeAccountRowData,
  ClaudeAccountsPanel,
  type ClaudeAccountsPanelProps,
  type ClaudeSignInStep,
} from "./ClaudeAccountsPanel";

const accounts: ClaudeAccountRowData[] = [
  {
    id: "work",
    label: "Work",
    detail: "me@acme.dev · Acme",
    plan: "Max",
    active: true,
    needsReauth: false,
    rateLimited: false,
  },
  {
    id: "home",
    label: "me@home.dev",
    plan: "Pro",
    active: false,
    needsReauth: false,
    rateLimited: true,
  },
  {
    id: "old",
    label: "Old team",
    detail: "Retired Org",
    plan: "Team",
    active: false,
    needsReauth: true,
    rateLimited: false,
  },
];

const meta: Meta<typeof ClaudeAccountsPanel> = {
  title: "Composites/ClaudeAccountsPanel",
  component: ClaudeAccountsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The computer's Claude accounts and an inline sign-in. Rows come from `claudeAccountRows` and the step from `claudeSignInPhase` in `@argus/client-core`. `browserOn=\"computer\"` is a remote client's flow: the browser opens on the computer, so the code field is there from the start.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof ClaudeAccountsPanel>;

function Interactive(
  props: Partial<ClaudeAccountsPanelProps> & { initialStep?: ClaudeSignInStep },
) {
  const [rows, setRows] = useState(props.accounts ?? accounts);
  const [step, setStep] = useState<ClaudeSignInStep>(
    props.initialStep ?? "idle",
  );
  const [kind, setKind] = useState<ClaudeAccountKind>("claudeai");

  return (
    <div style={{ maxWidth: 560 }}>
      <ClaudeAccountsPanel
        accountKind={kind}
        accounts={rows}
        step={step}
        onAccountKindChange={setKind}
        onCancelSignIn={() => setStep("idle")}
        onReauth={() => setStep("awaiting-browser")}
        onRemove={(id) => setRows((r) => (r ?? []).filter((a) => a.id !== id))}
        onRename={(id, label) =>
          setRows((r) =>
            (r ?? []).map((a) => (a.id === id ? { ...a, label } : a)),
          )
        }
        onSelect={(id) =>
          setRows((r) => (r ?? []).map((a) => ({ ...a, active: a.id === id })))
        }
        onStartSignIn={() => setStep("awaiting-browser")}
        onSubmitCode={() => setStep("submitting")}
        {...props}
      />
    </div>
  );
}

export const Accounts: Story = { render: () => <Interactive /> };

export const NoAccounts: Story = {
  render: () => <Interactive accounts={[]} />,
};

export const Loading: Story = {
  render: () => <Interactive accounts={null} />,
};

export const WaitingOnBrowser: Story = {
  render: () => (
    <Interactive
      initialStep="awaiting-browser"
      loginUrl="https://claude.ai/oauth/authorize?code=true"
      onOpenLoginUrl={() => {}}
    />
  ),
};

export const PasteCode: Story = {
  render: () => <Interactive initialStep="awaiting-code" />,
};

export const RemoteSignIn: Story = {
  render: () => (
    <Interactive
      browserOn="computer"
      initialStep="awaiting-browser"
      loginUrl="https://claude.ai/oauth/authorize?code=true"
    />
  ),
};

export const SignInFailed: Story = {
  render: () => (
    <Interactive
      browserOn="computer"
      outcome={{ ok: false, error: "That code didn't work. Start again." }}
    />
  ),
};

export const MonitorOnly: Story = {
  render: () => <Interactive canManage={false} />,
};
