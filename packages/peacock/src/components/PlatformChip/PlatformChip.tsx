import type { HTMLAttributes } from "react";
import { WebIcon } from "../../icons/HomeIcons";
import { SimulatorIcon, TerminalIcon } from "../../icons/Icons";
import styles from "./PlatformChip.module.css";

export type Platform = "android" | "desktop" | "ios" | "web";

const labels: Record<Platform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  desktop: "Desktop",
};

function renderPlatformIcon(platform: Platform) {
  if (platform === "web") {
    return <WebIcon size={10} />;
  }
  if (platform === "desktop") {
    return <TerminalIcon size={10} />;
  }

  return <SimulatorIcon size={10} />;
}

export interface PlatformChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Whether this chip is the currently selected platform. */
  active?: boolean;
  platform: Platform;
}

export function PlatformChip({
  platform,
  active,
  className,
  ...rest
}: PlatformChipProps) {
  const icon = renderPlatformIcon(platform);

  const classes = [
    styles.chip,
    active ? styles.chipActive : undefined,
    rest.onClick ? styles.chipInteractive : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-pressed={rest.onClick ? active : undefined}
      role={rest.onClick ? "button" : undefined}
      tabIndex={rest.onClick ? 0 : undefined}
      className={classes}
      {...rest}
    >
      {icon}
      {labels[platform]}
    </span>
  );
}
