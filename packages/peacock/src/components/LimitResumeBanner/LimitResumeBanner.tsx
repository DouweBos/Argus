import { ClockIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";

export interface LimitResumeBannerProps {
  /** Unix ms the automatic "continue" is scheduled for. */
  resumeAt: number;
  className?: string;
  /** Reference time, so "today" vs. a weekday is deterministic in stories. */
  now?: Date;
  /** Renders a Cancel button; omit for clients that can't control the agent. */
  onCancel?: () => void;
}

/** When a scheduled auto-continue fires, as "at 15:02" or "Mon at 15:02". */
export function formatLimitResume(at: number, now: Date = new Date()): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (when.toDateString() === now.toDateString()) {
    return `at ${time}`;
  }

  return `${when.toLocaleDateString([], { weekday: "short" })} at ${time}`;
}

/** An agent stalled on a spent usage limit, waiting to be continued. */
export function LimitResumeBanner({
  resumeAt,
  className,
  now,
  onCancel,
}: LimitResumeBannerProps) {
  return (
    <Banner
      className={className}
      leading={<ClockIcon size={12} />}
      tone="warning"
      trailing={
        onCancel && (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )
      }
    >
      Usage limit reached. Continues automatically{" "}
      {formatLimitResume(resumeAt, now)}.
    </Banner>
  );
}
