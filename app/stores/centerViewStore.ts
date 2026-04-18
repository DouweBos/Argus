import { create } from "zustand";

export type CenterView =
  | "activity"
  | "agents"
  | "devices"
  | "home"
  | "review-queue";

interface CenterViewData {
  view: CenterView;
}

const centerViewStore = create<CenterViewData>(() => ({
  view: "home",
}));

export const setCenterView = (view: CenterView): void => {
  centerViewStore.setState({ view });
};

export const useCenterView = (): CenterView => centerViewStore((s) => s.view);

export const getCenterView = (): CenterView => centerViewStore.getState().view;
