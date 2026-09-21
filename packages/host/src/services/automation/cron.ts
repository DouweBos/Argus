/**
 * A 5-field cron evaluator — `min hour dom mon dow` supporting star, comma,
 * hyphen ranges and step values. No dependency: the grammar automations need
 * is small, and a schedule library would drag a timezone database behind it.
 *
 * Fields are wall-clock in the automation's IANA zone, so "07:30 every day"
 * stays 07:30 across a DST shift. Matching is done in local calendar space and
 * converted to an instant only once a candidate matches, which is what keeps
 * the spring-forward gap and the fall-back repeat from producing a stray fire.
 */

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 are both Sunday)
];

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Vixie semantics: when both day fields are restricted, either may match. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(spec: string, index: number): Set<number> {
  const [min, max] = FIELD_RANGES[index];
  const out = new Set<number>();

  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new Error(`empty cron field element in "${spec}"`);
    }

    const [rangePart, stepPart] = trimmed.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`invalid cron step "${trimmed}"`);
      }
    }

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) {
      throw new Error(`invalid cron range "${trimmed}"`);
    }
    if (lo < min || hi > max) {
      throw new Error(`cron value out of range in "${trimmed}"`);
    }

    for (let v = lo; v <= hi; v += step) {
      out.add(v);
    }
  }

  return out;
}

/** Parse a 5-field cron expression. Throws on anything it does not accept. */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `cron expression must have 5 fields (min hour dom mon dow), got ${parts.length}`,
    );
  }

  const dayOfWeek = parseField(parts[4], 4);
  // 7 and 0 both mean Sunday; normalise so lookups only ever check 0..6.
  if (dayOfWeek.has(7)) {
    dayOfWeek.add(0);
    dayOfWeek.delete(7);
  }

  return {
    minute: parseField(parts[0], 0),
    hour: parseField(parts[1], 1),
    dayOfMonth: parseField(parts[2], 2),
    month: parseField(parts[3], 3),
    dayOfWeek,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

/** Whether an expression parses. Used to validate user input. */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);

    return true;
  } catch {
    return false;
  }
}

/** A wall-clock instant in some zone, as plain calendar fields. */
export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, fmt);
  }

  return fmt;
}

function partsOf(
  timezone: string,
  instant: number,
): LocalParts & { second: number } {
  const parts = formatterFor(timezone).formatToParts(new Date(instant));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset in ms of `timezone` from UTC at a given instant (local - utc). */
function offsetAt(timezone: string, instant: number): number {
  const p = partsOf(timezone, instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );

  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a local wall-clock time maps to. Two passes, because the offset
 * we need depends on the answer. A time inside the spring-forward gap resolves
 * to the moment the clock jumps to; a time repeated by the fall-back resolves
 * to its standard-time occurrence, so a schedule fires once, not twice.
 */
export function zonedTimeToUtc(timezone: string, p: LocalParts): number {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const first = guess - offsetAt(timezone, guess);

  return guess - offsetAt(timezone, first);
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(timezone: string, instant: number): LocalParts {
  const p = partsOf(timezone, instant);

  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(p: LocalParts): number {
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function dayMatches(fields: CronFields, p: LocalParts): boolean {
  const dom = fields.dayOfMonth.has(p.day);
  const dow = fields.dayOfWeek.has(weekdayOf(p));

  if (fields.domRestricted && fields.dowRestricted) {
    return dom || dow;
  }

  return dom && dow;
}

function nextDay(p: LocalParts): LocalParts {
  const day = p.day + 1;
  if (day <= daysInMonth(p.year, p.month)) {
    return { year: p.year, month: p.month, day, hour: 0, minute: 0 };
  }
  if (p.month === 12) {
    return { year: p.year + 1, month: 1, day: 1, hour: 0, minute: 0 };
  }

  return { year: p.year, month: p.month + 1, day: 1, hour: 0, minute: 0 };
}

function nextMonth(p: LocalParts): LocalParts {
  return p.month === 12
    ? { year: p.year + 1, month: 1, day: 1, hour: 0, minute: 0 }
    : { year: p.year, month: p.month + 1, day: 1, hour: 0, minute: 0 };
}

/** The next minute in local calendar space, carrying into the next hour or day. */
function nextMinute(p: LocalParts): LocalParts {
  if (p.minute < 59) {
    return { ...p, minute: p.minute + 1 };
  }
  if (p.hour < 23) {
    return { ...p, hour: p.hour + 1, minute: 0 };
  }

  return nextDay(p);
}

/** The next hour in local calendar space, at minute zero. */
function nextHour(p: LocalParts): LocalParts {
  return p.hour < 23 ? { ...p, hour: p.hour + 1, minute: 0 } : nextDay(p);
}

/** How far ahead to search before giving up — a cron like `0 0 30 2 *` never fires. */
const MAX_STEPS = 500_000;

/**
 * The next instant strictly after `from` at which the expression matches, or
 * null when it cannot match within four years.
 */
export function computeNextRun(
  expression: string,
  timezone: string,
  from: number,
): number | null {
  const fields = parseCron(expression);
  let candidate = zonedParts(timezone, from + 60_000);
  const limitYear = candidate.year + 4;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (candidate.year > limitYear) {
      return null;
    }
    if (!fields.month.has(candidate.month)) {
      candidate = nextMonth(candidate);
      continue;
    }
    if (!dayMatches(fields, candidate)) {
      candidate = nextDay(candidate);
      continue;
    }
    if (!fields.hour.has(candidate.hour)) {
      candidate = nextHour(candidate);
      continue;
    }
    if (!fields.minute.has(candidate.minute)) {
      candidate = nextMinute(candidate);
      continue;
    }

    const instant = zonedTimeToUtc(timezone, candidate);
    // A fall-back hour repeats its wall-clock minutes; only the first
    // occurrence after `from` counts, so step past anything already gone.
    if (instant > from) {
      return instant;
    }
    candidate = nextMinute(candidate);
  }

  return null;
}
