/** Structured JSON logs (one line per event) for any log drain. Never pass secrets. */
type Level = "info" | "warn" | "error";
const SECRET_KEYS = /token|secret|key|password|authorization|cookie/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (v instanceof Error) return { name: v.name, message: v.message };
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : scrub(x, depth + 1)]));
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
