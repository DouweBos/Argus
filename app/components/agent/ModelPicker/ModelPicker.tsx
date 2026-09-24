import type { RegisteredRunner } from "../../../lib/types";
import type { RefObject } from "react";
import { PickerPopover } from "@argus/peacock";

export interface ModelOption {
  /** Optional short description shown below the name. */
  description?: string;
  /** Display label shown in the picker. */
  displayName: string;
  /** The model identifier sent to the CLI (e.g. "claude-opus-4-6"). */
  value: string;
}

/**
 * Runner state surfaced at the top of the picker.
 *
 * - `locked: true`: the runner is read-only — this agent's conversation has
 *   started, and its transcript belongs to that runner.
 * - `locked: false` + `available` provided: the user can switch between
 *   registered runners. With only one registered the list collapses to a
 *   single non-interactive entry.
 */
export interface RunnerSelection {
  /** Registered runners surfaced as choices. Required when `locked` is false. */
  available?: RegisteredRunner[];
  /** Currently bound or proposed runner id. */
  currentId: string;
  /** When true, the runner is fixed for this agent and cannot change. */
  locked: boolean;
  /** Callback fired when a different runner is picked (only when not locked). */
  onSelect?: (runnerId: string) => void;
}

/**
 * Claude accounts surfaced above the runner. Pinning a session to an account
 * lets sessions run in parallel on different accounts; `null` follows the
 * app-wide active account picked in Settings.
 */
export interface AccountSelection {
  /** Account the app falls back to when nothing is pinned. */
  activeId: string | null;
  /** Accounts available to pin to. */
  available: AccountOption[];
  /** Currently pinned account, or null when following the app default. */
  currentId: string | null;
  onSelect: (accountId: string | null) => void;
}

export interface AccountOption {
  /** Optional second line, e.g. the organization or plan. */
  description?: string;
  displayName: string;
  id: string;
}

interface ModelPickerProps {
  /** Account section rendered above the runner. Omit to hide it. */
  account?: AccountSelection;
  currentModel: string | undefined;
  models: ModelOption[];
  onClose: () => void;
  onSelect: (modelValue: string) => void;
  /**
   * Runner displayed above the model list. When omitted, the picker behaves
   * like a model-only switcher (legacy callers).
   */
  runner?: RunnerSelection;
  /** Element the picker should anchor to. Picker opens above and aligned to its left. */
  triggerRef: RefObject<HTMLElement | null>;
}

export function ModelPicker({
  models,
  currentModel,
  onSelect,
  onClose,
  account,
  runner,
  triggerRef,
}: ModelPickerProps) {
  return (
    <PickerPopover triggerRef={triggerRef} onClose={onClose}>
      {account && account.available.length > 0 && (
        <AccountSection account={account} />
      )}
      {runner && <RunnerSection runner={runner} />}

      <PickerPopover.Header>Switch model</PickerPopover.Header>
      {models.map((model) => (
        <PickerPopover.Option
          key={model.value}
          name={model.displayName}
          description={model.description}
          selected={model.value === currentModel}
          onSelect={() => onSelect(model.value)}
        />
      ))}
    </PickerPopover>
  );
}

function AccountSection({ account }: { account: AccountSelection }) {
  const followLabel =
    account.available.find((a) => a.id === account.activeId)?.displayName ??
    "app default";

  const options: { description?: string; id: string | null; name: string }[] = [
    { id: null, name: "Follow app default", description: followLabel },
    ...account.available.map((a) => ({
      id: a.id,
      name: a.displayName,
      description: a.description,
    })),
  ];

  return (
    <>
      <PickerPopover.Header>Account</PickerPopover.Header>
      {options.map((opt) => (
        <PickerPopover.Option
          key={opt.id ?? "default"}
          name={opt.name}
          description={opt.description}
          selected={opt.id === account.currentId}
          onSelect={() => account.onSelect(opt.id)}
        />
      ))}
    </>
  );
}

function RunnerSection({ runner }: { runner: RunnerSelection }) {
  const available = runner.available ?? [];
  const current =
    available.find((r) => r.id === runner.currentId) ??
    fallbackRunner(runner.currentId);

  // Locked (this agent's conversation has started) or only one registered
  // runner:
  // render a single read-only row.
  const selectable = !runner.locked && available.length > 1;

  if (!selectable) {
    return (
      <>
        <PickerPopover.Header>Runner</PickerPopover.Header>
        <PickerPopover.Static
          name={current.displayName}
          description={runner.locked ? "Fixed for this agent" : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PickerPopover.Header>Runner</PickerPopover.Header>
      {available.map((opt) => (
        <PickerPopover.Option
          key={opt.id}
          name={opt.displayName}
          selected={opt.id === runner.currentId}
          onSelect={() => runner.onSelect?.(opt.id)}
        />
      ))}
    </>
  );
}

function fallbackRunner(id: string): { displayName: string; id: string } {
  // Render an id-derived label when the registry hasn't been read yet.
  // The displayName is replaced as soon as `list_runners` returns.
  return { id, displayName: id };
}
