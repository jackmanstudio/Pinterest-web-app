/**
 * Plans posting times for a set of pins: a few per day, inside your posting
 * window, with an even gap between them and away from pins already scheduled.
 * Times are computed in the user's own timezone.
 */
export interface SpreadOptions {
  /** First moment a pin may go out. */
  start: Date;
  perDay: number;
  /** Local hours, inclusive start, exclusive end (e.g. 12 → 23). */
  fromHour: number;
  toHour: number;
  timeZone: string;
  /** Minimum minutes between any two pins, including ones already scheduled. */
  minGapMinutes?: number;
  existing?: Date[];
}

const MIN = 60_000;

/** Offset in minutes of `timeZone` from UTC at a given instant. */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MIN);
  } catch {
    return 0;
  }
}

/** The UTC instant of a local wall-clock time in `timeZone`. */
export function zonedTime(y: number, m: number, d: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(y, m, d, hour, minute);
  const off = tzOffsetMinutes(new Date(guess), timeZone);
  const first = guess - off * MIN;
  const off2 = tzOffsetMinutes(new Date(first), timeZone);
  return new Date(guess - off2 * MIN);
}

function localDate(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const local = new Date(at.getTime() + tzOffsetMinutes(at, timeZone) * MIN);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

export function spreadTimes(count: number, o: SpreadOptions): Date[] {
  const perDay = Math.max(1, Math.min(25, Math.floor(o.perDay)));
  const from = Math.max(0, Math.min(23, Math.floor(o.fromHour)));
  const to = Math.max(from + 1, Math.min(24, Math.floor(o.toHour)));
  const windowMin = (to - from) * 60;
  const step = windowMin / perDay;
  const gap = Math.max(o.minGapMinutes ?? 0, 0) * MIN;
  const taken = (o.existing ?? []).map((d) => d.getTime());
  const out: Date[] = [];
  const { y, m, d } = localDate(o.start, o.timeZone);
  for (let day = 0; out.length < count && day < 400; day++) {
    const date = new Date(Date.UTC(y, m, d + day));
    const [yy, mm, dd] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    const dayStart = zonedTime(yy, mm, dd, 0, 0, o.timeZone).getTime();
    const dayEnd = zonedTime(yy, mm, dd + 1, 0, 0, o.timeZone).getTime();
    let placed = taken.filter((t) => t >= dayStart && t < dayEnd).length;
    for (let i = 0; i < perDay && out.length < count && placed < perDay; i++) {
      // Centre each slot in its share of the window, on a 5-minute mark.
      const minute = Math.round((from * 60 + step * i + step / 2) / 5) * 5;
      const t = zonedTime(yy, mm, dd, Math.floor(minute / 60), minute % 60, o.timeZone).getTime();
      if (t < o.start.getTime()) continue;
      if (gap && taken.some((x) => Math.abs(x - t) < gap)) continue;
      out.push(new Date(t));
      taken.push(t);
      placed++;
    }
  }
  return out;
}
