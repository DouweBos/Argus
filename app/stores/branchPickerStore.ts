import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface BranchPickerState {
  repoRoot: string | null;
  sessionId: string | null;
}

const store = create<BranchPickerState>(() => ({
  repoRoot: null,
  sessionId: null,
}));

export const showBranchPicker = (repoRoot: string, sessionId: string) =>
  store.setState({ repoRoot, sessionId });

export const hideBranchPicker = () =>
  store.setState({ repoRoot: null, sessionId: null });

export const useBranchPickerTarget = () =>
  store(useShallow((s) => ({ repoRoot: s.repoRoot, sessionId: s.sessionId })));
