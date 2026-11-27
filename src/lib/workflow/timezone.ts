/** A real IANA timezone name such as "Asia/Karachi" (checked with Intl), else null. */
export function cleanTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Shows a UTC instant in the timezone the user scheduled it in. */
export function formatInZone(iso: string, tz: string | null, locale = "en-US"): string {
  const zone = cleanTimeZone(tz) ?? "UTC";
  return new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + ` (${zone})`;
}
