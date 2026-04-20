import { create } from "zustand";
import { pushRoute } from "../lib/router";

export type CenterView =
  | "activity"
  | "agents"
  | "devices"
  | "home"
  | "organizations"
  | "review-queue";

interface CenterViewData {
  selectedOrganizationId: string | null;
  view: CenterView;
}

const centerViewStore = create<CenterViewData>(() => ({
  view: "home",
  selectedOrganizationId: null,
}));

export const setCenterView = (view: CenterView): void => {
  centerViewStore.setState({ view, selectedOrganizationId: null });
  pushRoute({ view });
};

export const clearSelectedOrganization = (): void => {
  centerViewStore.setState({ selectedOrganizationId: null });
};

export const openOrganization = (organizationId: string): void => {
  centerViewStore.setState({
    view: "organizations",
    selectedOrganizationId: organizationId,
  });
  pushRoute({ view: "organizations", organizationId });
};

export const useCenterView = (): CenterView => centerViewStore((s) => s.view);

export const useSelectedOrganizationId = (): string | null =>
  centerViewStore((s) => s.selectedOrganizationId);

export const getCenterView = (): CenterView => centerViewStore.getState().view;
