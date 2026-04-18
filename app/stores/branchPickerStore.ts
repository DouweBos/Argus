import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface BranchPickerState {
  repoRoot: string | null;
  workspaceId: string | null;
}

const store = create<BranchPickerState>(() => ({
  repoRoot: null,
  workspaceId: null,
}));

export const showBranchPicker = (repoRoot: string, workspaceId: string) =>
  store.setState({ repoRoot, workspaceId });

export const hideBranchPicker = () =>
  store.setState({ repoRoot: null, workspaceId: null });

export const useBranchPickerTarget = () =>
  store(
    useShallow((s) => ({ repoRoot: s.repoRoot, workspaceId: s.workspaceId })),
  );
