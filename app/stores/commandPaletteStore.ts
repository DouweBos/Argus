import { create } from "zustand";

interface CommandPaletteState {
  open: boolean;
}

const store = create<CommandPaletteState>(() => ({ open: false }));

export const openCommandPalette = () => store.setState({ open: true });
export const closeCommandPalette = () => store.setState({ open: false });
export const toggleCommandPalette = () =>
  store.setState((s) => ({ open: !s.open }));

export const useCommandPaletteOpen = () => store((s) => s.open);
