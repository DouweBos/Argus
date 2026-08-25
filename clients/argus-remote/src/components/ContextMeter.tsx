/** Circular context-window meter — the phone twin of Peacock's ContextMeter. */

import Svg, { Circle } from "react-native-svg";
import { useTheme } from "../theme";

export function ContextMeter({
  progress,
  size = 18,
}: {
  progress: number;
  size?: number;
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const tone =
    clamped > 0.9 ? theme.error : clamped > 0.7 ? theme.warning : theme.accent;

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={theme.border}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
