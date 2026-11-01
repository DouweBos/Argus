/**
 * The common cron shapes in words, falling back to the expression itself for
 * anything fancier — a wrong plain-English reading of a cron is worse than
 * the cron. Port of ArgusKit's `Labels.cronLabel`; the tests share its vectors.
 */

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function int(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ordinal(day: number): string {
  if (day === 11 || day === 12 || day === 13) {
    return `${day}th`;
  }
  const suffix =
    ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][day % 10] ??
    "th";

  return `${day}${suffix}`;
}

export function cronLabel(cron: string): string {
  const parts = cron.split(" ").filter(Boolean);
  if (parts.length !== 5) {
    return cron;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const everyDay = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";
  if (
    minute.startsWith("*/") &&
    int(minute.slice(2)) !== null &&
    hour === "*" &&
    everyDay
  ) {
    return `every ${minute.slice(2)} minutes`;
  }
  const minuteValue = int(minute);
  if (minuteValue === null || minuteValue > 59 || month !== "*") {
    return cron;
  }
  if (everyDay) {
    if (hour === "*") {
      return `hourly at :${pad(minuteValue)}`;
    }
    const step = hour.startsWith("*/") ? int(hour.slice(2)) : null;
    if (step !== null && minuteValue === 0) {
      return `every ${step} hours`;
    }
  }
  const hourValue = int(hour);
  if (hourValue === null || hourValue > 23) {
    return cron;
  }
  const time = `${pad(hourValue)}:${pad(minuteValue)}`;

  if (dayOfWeek === "*") {
    if (dayOfMonth === "*") {
      return `${time} daily`;
    }
    const day = int(dayOfMonth);

    return day !== null && day >= 1 && day <= 31
      ? `${time} monthly on the ${ordinal(day)}`
      : cron;
  }
  if (dayOfMonth !== "*") {
    return cron;
  }
  if (dayOfWeek === "1-5") {
    return `${time} weekdays`;
  }
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0" || dayOfWeek === "6-7") {
    return `${time} weekends`;
  }
  const days = dayOfWeek.split(",").map(int);
  if (days.length === 0 || days.some((d) => d === null || d > 7)) {
    return cron;
  }
  const names = days.map((d) => WEEKDAYS[(d ?? 0) % 7]);

  return names.length === 1
    ? `${time} ${names[0]}s`
    : `${time} ${names.map((n) => n.slice(0, 3)).join(", ")}`;
}
