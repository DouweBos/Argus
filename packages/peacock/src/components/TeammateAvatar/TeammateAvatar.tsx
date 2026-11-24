import type {
  TeammateAvatar as TeammateLook,
  TeammateColor,
  TeammateSymbol,
} from "@argus/remote-protocol";
import type { ComponentType } from "react";
import {
  BoltIcon,
  BugIcon,
  CalendarIcon,
  EyeIcon,
  type IconProps,
  InboxIcon,
  LeafIcon,
  LogsIcon,
  PackageIcon,
  PersonIcon,
  SearchIcon,
  SparklesIcon,
  WrenchIcon,
} from "../../icons/Icons";
import styles from "./TeammateAvatar.module.css";

/** In the order the pickers offer them, as ArgusCore's `TeammateDraft`. */
export const TEAMMATE_COLORS: TeammateColor[] = [
  "blue",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
];

export const TEAMMATE_SYMBOLS: TeammateSymbol[] = [
  "wrench",
  "eye",
  "tray",
  "shippingbox",
  "doc",
  "ant",
  "calendar",
  "leaf",
  "sparkles",
  "bolt",
  "magnifyingglass",
  "person",
];

const SYMBOL_ICONS: Record<TeammateSymbol, ComponentType<IconProps>> = {
  ant: BugIcon,
  bolt: BoltIcon,
  calendar: CalendarIcon,
  doc: LogsIcon,
  eye: EyeIcon,
  leaf: LeafIcon,
  magnifyingglass: SearchIcon,
  person: PersonIcon,
  shippingbox: PackageIcon,
  sparkles: SparklesIcon,
  tray: InboxIcon,
  wrench: WrenchIcon,
};

/** The symbol's icon, for pickers that list them. */
export function TeammateSymbolIcon({
  symbol,
  ...props
}: IconProps & { symbol: TeammateSymbol }) {
  const Icon = SYMBOL_ICONS[symbol] ?? PersonIcon;

  return <Icon {...props} />;
}

export function teammateInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

export interface TeammateAvatarProps {
  name: string;
  color: TeammateColor;
  avatar: TeammateLook;
  /** Pixel diameter. */
  size?: number;
  className?: string;
}

/** A teammate's face: its symbol or initials on a tint of its colour. */
export function TeammateAvatar({
  avatar,
  className,
  color,
  name,
  size = 32,
}: TeammateAvatarProps) {
  const classes = [styles.avatar, styles[color] ?? styles.blue, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-hidden
      className={classes}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {avatar.kind === "symbol" ? (
        <TeammateSymbolIcon
          size={Math.round(size * 0.5)}
          symbol={avatar.symbol}
        />
      ) : (
        teammateInitials(name) || "?"
      )}
    </span>
  );
}
