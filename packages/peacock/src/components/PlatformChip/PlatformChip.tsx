import type { HTMLAttributes } from "react";
import styles from "./PlatformChip.module.css";
import { SimulatorIcon, TerminalIcon } from "../../icons/Icons";
import { WebIcon } from "../../icons/HomeIcons";

export type Platform = "ios" | "android" | "web" | "desktop";

const labels: Record<Platform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  desktop: "Desktop",
};

export interface PlatformChipProps extends HTMLAttributes<HTMLSpanElement> {
  platform: Platform;
}

export function PlatformChip({
  platform,
  className,
  ...rest
}: PlatformChipProps) {
  const icon =
    platform === "web" ? (
      <WebIcon size={10} />
    ) : platform === "desktop" ? (
      <TerminalIcon size={10} />
    ) : (
      <SimulatorIcon size={10} />
    );
  return (
    <span
      className={[styles.chip, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon}
      {labels[platform]}
    </span>
  );
}
