import { create } from "zustand";

interface OpenPaletteState {
  open: boolean;
}

const store = create<OpenPaletteState>(() => ({ open: false }));

export const openOpenPalette = () => store.setState({ open: true });
export const closeOpenPalette = () => store.setState({ open: false });
export const toggleOpenPalette = () =>
  store.setState((s) => ({ open: !s.open }));

export const useOpenPaletteOpen = () => store((s) => s.open);
