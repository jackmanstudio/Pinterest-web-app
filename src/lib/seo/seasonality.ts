/**
 * Seasonal timing for a pin's topic. A built-in calendar of yearly moments,
 * not live trend data. People plan on Pinterest well ahead of an event, so a
 * seasonal pin does best when it is posted weeks before the date, not on it.
 */
export interface SeasonEvent {
  id: string;
  label: string;
  /** Month (0-11) and day of the peak date. */
  month: number;
  day: number;
  /** Days before the peak when planning searches start to build. */
  lead: number;
  /** Days after the peak when interest is mostly gone. */
  tail: number;
  words: string[];
  /** For moving dates: the [month, day] of the peak in a given year. */
  on?: (year: number) => [number, number];
}

/** Gregorian Easter Sunday (anonymous algorithm). */
export function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month - 1, ((h + l - 7 * m + 114) % 31) + 1];
}
/** The nth given weekday (0 = Sunday) of a month. */
export function nthWeekday(y: number, month: number, weekday: number, n: number): [number, number] {
  const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
  return [month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7];
}

export const SEASON_EVENTS: SeasonEvent[] = [
  { id: "new-year", label: "New Year", month: 0, day: 1, lead: 45, tail: 20, words: ["new year", "new year's", "nye", "resolution", "resolutions", "january reset"] },
  { id: "valentines", label: "Valentine's Day", month: 1, day: 14, lead: 50, tail: 3, words: ["valentine", "valentine's", "valentines", "galentine", "galentine's"] },
  { id: "st-patricks", label: "St. Patrick's Day", month: 2, day: 17, lead: 40, tail: 2, words: ["st patrick", "st. patrick", "st patrick's", "shamrock"] },
  { id: "easter", label: "Easter", month: 3, day: 5, lead: 50, tail: 3, words: ["easter", "easter egg", "easter basket"], on: easter },
  // US date (second Sunday of May); the UK's is in March.
  { id: "mothers-day", label: "Mother's Day", month: 4, day: 10, lead: 45, tail: 2, words: ["mother's day", "mothers day", "gifts for mom"], on: (y) => nthWeekday(y, 4, 0, 2) },
  { id: "wedding", label: "Wedding season", month: 5, day: 15, lead: 90, tail: 75, words: ["wedding", "bridal", "bridesmaid", "wedding guest"] },
  { id: "fathers-day", label: "Father's Day", month: 5, day: 18, lead: 45, tail: 2, words: ["father's day", "fathers day", "gifts for dad"], on: (y) => nthWeekday(y, 5, 0, 3) },
  { id: "summer", label: "Summer", month: 6, day: 1, lead: 75, tail: 50, words: ["summer", "beach", "pool party", "vacation outfit", "heatwave", "4th of july", "fourth of july"] },
  { id: "back-to-school", label: "Back to school", month: 7, day: 20, lead: 60, tail: 20, words: ["back to school", "back-to-school", "school lunch", "dorm", "classroom"] },
  { id: "fall", label: "Autumn", month: 9, day: 1, lead: 60, tail: 50, words: ["fall", "autumn", "pumpkin spice", "cozy fall", "fall outfit", "fall decor"] },
  { id: "halloween", label: "Halloween", month: 9, day: 31, lead: 60, tail: 1, words: ["halloween", "costume", "costumes", "trick or treat", "spooky"] },
  { id: "thanksgiving", label: "Thanksgiving", month: 10, day: 26, lead: 50, tail: 1, words: ["thanksgiving", "friendsgiving"], on: (y) => nthWeekday(y, 10, 4, 4) },
  { id: "black-friday", label: "Black Friday & Cyber Monday", month: 10, day: 28, lead: 35, tail: 4, words: ["black friday", "cyber monday"], on: (y) => { const [m, d] = nthWeekday(y, 10, 4, 4); return [m, d + 1]; } },
  { id: "christmas", label: "Christmas & holidays", month: 11, day: 25, lead: 75, tail: 2, words: ["christmas", "xmas", "holiday gift", "holiday gifts", "holiday party", "stocking stuffer", "stocking stuffers", "advent", "gift guide"] },
  { id: "winter", label: "Winter", month: 0, day: 15, lead: 60, tail: 45, words: ["winter", "snow day", "cozy winter", "winter outfit", "ski trip"] },
  { id: "spring", label: "Spring", month: 3, day: 1, lead: 60, tail: 45, words: ["spring", "spring cleaning", "spring outfit", "spring decor"] },
];

export type TimingStatus = "ahead" | "peak" | "late" | "off" | "evergreen";

export interface SeasonTiming {
  status: TimingStatus;
  event?: SeasonEvent;
  /** Days until the next peak (negative when it just passed). */
  days?: number;
  message: string;
}

const DAY = 86_400_000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(text);

/** Which yearly moments a piece of text is about (most specific first). */
export function detectEvents(text: string): SeasonEvent[] {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  const hits = SEASON_EVENTS.filter((e) => e.words.some((w) => mentions(t, w)));
  // Prefer a holiday over the broad season it falls in.
  const broad = new Set(["summer", "fall", "winter", "spring"]);
  return hits.sort((a, b) => Number(broad.has(a.id)) - Number(broad.has(b.id)));
}

/** Days from `now` to the nearest peak of the event (this year, last year or next). */
export function daysToPeak(e: SeasonEvent, now: Date): number {
  const y = now.getFullYear();
  const today = Date.UTC(y, now.getMonth(), now.getDate());
  const peak = (yy: number) => (e.on ? e.on(yy) : [e.month, e.day]);
  const diffs = [y - 1, y, y + 1].map((yy) => {
    const [m, d] = peak(yy);
    return Math.round((Date.UTC(yy, m, d) - today) / DAY);
  });
  // The most recent peak while we are still in its tail, otherwise the next one.
  return diffs.find((d) => d >= -e.tail)!;
}

export function seasonTiming(text: string, now: Date = new Date()): SeasonTiming {
  const [event] = detectEvents(text);
  if (!event) return { status: "evergreen", message: "Evergreen topic: no seasonal date to time it around." };
  const days = daysToPeak(event, now);
  const ideal = Math.round(event.lead * 0.75);
  if (days < 0) {
    return { status: "late", event, days, message: `${event.label} just passed; interest drops fast now. Save this pin to schedule about ${ideal} days before next year's date.` };
  }
  if (days <= 7) {
    return { status: "peak", event, days, message: `${event.label} is ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}: last-minute searches only. Next time, post about ${ideal} days ahead.` };
  }
  if (days <= event.lead) {
    return { status: "ahead", event, days, message: `Good timing: ${event.label} is in ${days} days, while people are still planning.` };
  }
  return {
    status: "off",
    event,
    days,
    message: `${event.label} is ${days} days away; searches usually start about ${event.lead} days before. Schedule it closer to then for more reach.`,
  };
}
