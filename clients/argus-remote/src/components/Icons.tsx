/**
 * Icon set for the phone client, drawn with `react-native-svg`. Mirrors the
 * Peacock icons we need at the same 1.5 stroke weight (Peacock itself is
 * DOM-only, so it can't be reused here).
 */

import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";

export interface IconProps {
  size?: number;
  color?: string;
}

function Icon({
  size = 16,
  color = "currentColor",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <Polyline points="15 18 9 12 15 6" />
  </Icon>
);
export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <Polyline points="9 18 15 12 9 6" />
  </Icon>
);
export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <Polyline points="6 9 12 15 18 9" />
  </Icon>
);
export const Folder = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const File = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <Polyline points="14 3 14 8 19 8" />
  </Icon>
);
export const Branch = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="6" cy="6" r="2.5" />
    <Circle cx="6" cy="18" r="2.5" />
    <Circle cx="18" cy="8" r="2.5" />
    <Path d="M6 8.5v7M18 10.5c0 4-6 2.5-6 7" />
  </Icon>
);
export const Repo = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
    <Path d="M5 16h14" />
  </Icon>
);
export const Agent = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="4" y="7" width="16" height="12" rx="3" />
    <Path d="M12 3v4" />
    <Circle cx="9" cy="13" r="1" />
    <Circle cx="15" cy="13" r="1" />
  </Icon>
);
export const Desktop = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="3" y="4" width="18" height="12" rx="2" />
    <Path d="M8 20h8" />
    <Path d="M12 16v4" />
  </Icon>
);
export const Trash = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 7h16" />
    <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <Path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
  </Icon>
);
export const Gear = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17.7 5.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20 11h.1a2 2 0 1 1 0 4z" />
  </Icon>
);
export const Refresh = (p: IconProps) => (
  <Icon {...p}>
    <Polyline points="21 4 21 10 15 10" />
    <Polyline points="3 20 3 14 9 14" />
    <Path d="M19 9a7 7 0 0 0-12-3L3 10M5 15a7 7 0 0 0 12 3l4-4" />
  </Icon>
);
export const Simulator = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="6" y="2" width="12" height="20" rx="3" />
    <Path d="M11 18.5h2" />
  </Icon>
);
export const Stop = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);
export const Send = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);
export const Paperclip = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
  </Icon>
);
export const Clipboard = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="8" y="2" width="8" height="4" rx="1" />
    <Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </Icon>
);
export const Camera = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <Circle cx="12" cy="12.5" r="3.5" />
  </Icon>
);
export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Close = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const Ellipsis = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx="5" cy="12" r="1.2" />
    <Circle cx="12" cy="12" r="1.2" />
    <Circle cx="19" cy="12" r="1.2" />
  </Icon>
);
export const Home = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 11 12 4l8 7v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  </Icon>
);
export const ArrowBack = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M19 12H5" />
    <Polyline points="11 18 5 12 11 6" />
  </Icon>
);
export const AndroidBack = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M17 6 8 12l9 6z" />
  </Icon>
);
export const AndroidRecents = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Icon>
);
export const Keyboard = (p: IconProps) => (
  <Icon {...p}>
    <Rect x="2.5" y="6" width="19" height="12" rx="2" />
    <Path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
  </Icon>
);
export const Check = (p: IconProps) => (
  <Icon {...p}>
    <Polyline points="4 12.5 9.5 18 20 6.5" />
  </Icon>
);
