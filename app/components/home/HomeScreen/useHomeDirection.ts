import { useEffect, useState } from "react";

export type HomeDirection = "command-center" | "live-activity" | "orrery";

const STORAGE_KEY = "argus:home-direction";
const DEFAULT: HomeDirection = "command-center";

function read(): HomeDirection {
  if (typeof localStorage === "undefined") {
    return DEFAULT;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (
    stored === "command-center" ||
    stored === "live-activity" ||
    stored === "orrery"
  ) {
    return stored;
  }

  return DEFAULT;
}

export function useHomeDirection(): [
  HomeDirection,
  (d: HomeDirection) => void,
] {
  const [direction, setDirection] = useState<HomeDirection>(read);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, direction);
    } catch {
      // no-op — private browsing etc.
    }
  }, [direction]);

  return [direction, setDirection];
}
