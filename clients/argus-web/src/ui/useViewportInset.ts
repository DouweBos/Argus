/**
 * Height the iOS software keyboard steals from the layout viewport. Written to
 * `--aw-keyboard-inset` so the docked composer can sit above it; without this
 * the keyboard covers the input on iPad.
 */

import { useEffect } from "react";

export function useViewportInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }

    const apply = () => {
      const inset = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      document.documentElement.style.setProperty(
        "--aw-keyboard-inset",
        `${Math.round(inset)}px`,
      );
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);

    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--aw-keyboard-inset");
    };
  }, []);
}
