import { type DeltaTone, StatCell, StatsStrip } from "../StatsStrip/StatsStrip";

export interface ReportStatItem {
  delta?: number;
  label: string;
  value: string;
}

export interface ReportStatsProps {
  items: ReportStatItem[];
}

/** Formats a signed change the way a report reads it: `+3` / `-2`. */
function deltaText(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function deltaTone(delta: number | undefined): DeltaTone {
  if (delta == null || delta === 0) {
    return "neutral";
  }

  return delta > 0 ? "positive" : "negative";
}

/** The `stats` block — headline numbers, each with an optional change. */
export function ReportStats({ items }: ReportStatsProps) {
  return (
    <StatsStrip>
      {items.map((item, i) => (
        <StatCell
          key={`${item.label}-${i}`}
          label={item.label}
          value={item.value}
          delta={item.delta == null ? undefined : deltaText(item.delta)}
          deltaTone={deltaTone(item.delta)}
        />
      ))}
    </StatsStrip>
  );
}
